# -*- coding: utf-8 -*-
"""E2E：场景创建/修改 → 场景练习 → 评分 闭环全链路测试

覆盖：
  A. 场景创建（字段回读 / 必填与引用校验 / 权限）
  B. 场景修改（部分更新 / 校验 / 权限 / 持久化验证）
  C. 练习闭环（建会话 → 回合 → 提示 → 结束评分 → 复盘 → 任务状态）
  D. 场景修改对练习闭环的影响（新会话生效）
  E. 场景删除（权限 / 级联：新会话、进行中会话、复盘、任务列表）

运行前提：API 在 localhost:3060（pnpm dev:api），种子数据已灌入（admin1/123456）。
"""
import json, sys, time, urllib.request, urllib.error, uuid

BASE = 'http://localhost:3060/api/v1'

fails = []
def check(name, cond, extra=''):
    print(('PASS' if cond else 'FAIL'), name, ('| ' + str(extra)[:220] if extra else ''))
    if not cond: fails.append(name)

def call(method, path, body=None, token=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if token: req.add_header('Authorization', 'Bearer ' + token)
    if data: req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, {}

# ───────── 登录：admin + 新注册学员 ─────────
s, d = call('POST', '/auth/login', {'username': 'admin1', 'password': '123456'})
assert s == 200, f'admin 登录失败: {s} {d}'
ADMIN = d['token']

uname = 'e2e_' + uuid.uuid4().hex[:8]
s, d = call('POST', '/auth/register', {'username': uname, 'name': 'E2E学员', 'password': '123456'})
assert s in (200, 201), f'学员注册失败: {s} {d}'
TRAINEE = d['token']
print(f'== 登录成功: admin1 / {uname} ==\n')

s, d = call('GET', '/skill-points', token=ADMIN)
sps = d['skillPoints']
assert len(sps) >= 2, '技能点不足'
SP1, SP2 = sps[0]['id'], sps[1]['id']
s, d = call('GET', '/persona-configs', token=ADMIN)
personas = d['personaConfigs']
assert len(personas) >= 1, '无陪练员'
PERSONA = personas[0]['id']

# ═════════ A. 场景创建 ═════════
print('── A. 场景创建 ──')
BODY = {
    'name': 'E2E闭环测试场景',
    'personaConfigId': PERSONA,
    'skillPointIds': [SP1, SP2],
    'passScore': 60,
    'durationMinutes': 5,
    'difficulty': 2,
    'coverageTopics': ['价格', '效果'],
}
s, d = call('POST', '/scenarios', BODY, ADMIN)
check('A1 创建场景 201', s == 201, s)
SID = d.get('id')
check('A2 passScore 回读', d.get('successCriteria', {}).get('passScore') == 60, d.get('successCriteria'))
check('A3 difficulty 回读', d.get('difficulty') == 2)

s, d = call('POST', '/scenarios', {'personaConfigId': PERSONA, 'skillPointIds': [SP1], 'passScore': 60, 'durationMinutes': 5}, ADMIN)
check('A4 缺 name → 400', s == 400, f'{s} {d}')
s, d = call('POST', '/scenarios', {**BODY, 'personaConfigId': 'no-such-persona'}, ADMIN)
check('A5 persona 不存在 → 400', s == 400, f'{s} {d}')
s, d = call('POST', '/scenarios', {**BODY, 'skillPointIds': []}, ADMIN)
check('A6 空技能点 → 400', s == 400, f'{s} {d}')
s, d = call('POST', '/scenarios', {**BODY, 'skillPointIds': ['no-such-sp']}, ADMIN)
check('A7 技能点不存在 → 400', s == 400, f'{s} {d}')
s, d = call('POST', '/scenarios', {**BODY, 'sceneType': 'xxx'}, ADMIN)
check('A8 非法 sceneType → 400', s == 400, f'{s} {d}')
s, d = call('POST', '/scenarios', {**BODY, 'passScore': '60'}, ADMIN)
check('A9 passScore 非数字 → 400', s == 400, f'{s} {d}')
s, d = call('POST', '/scenarios', BODY, TRAINEE)
check('A10 学员创建场景 → 403', s == 403, f'{s} {d}')

# ═════════ B. 场景修改 ═════════
print('\n── B. 场景修改 ──')
s, d = call('PUT', f'/scenarios/{SID}', {'name': 'E2E闭环测试场景-改'}, ADMIN)
check('B1 改 name 200', s == 200 and d.get('name') == 'E2E闭环测试场景-改', f'{s} {d.get("name")}')
check('B2 部分更新不动其他字段', d.get('personaConfigId') == PERSONA and d.get('skillPointIds') == [SP1, SP2]
      and d.get('successCriteria', {}).get('passScore') == 60, json.dumps(d, ensure_ascii=False)[:200])

s, d = call('PUT', f'/scenarios/{SID}', {'passScore': 70}, ADMIN)
check('B3 改 passScore', s == 200 and d.get('successCriteria', {}).get('passScore') == 70, f'{s} {d.get("successCriteria")}')

s, d = call('PUT', f'/scenarios/{SID}', {'skillPointIds': [SP1]}, ADMIN)
check('B4 改技能点', s == 200 and d.get('skillPointIds') == [SP1], f'{s} {d.get("skillPointIds")}')
s, d = call('PUT', f'/scenarios/{SID}', {'skillPointIds': ['bad-sp']}, ADMIN)
check('B5 改技能点为不存在 → 400', s == 400, f'{s} {d}')
s, d = call('PUT', f'/scenarios/{SID}', {'skillPointIds': []}, ADMIN)
check('B6 改技能点为空 → 400', s == 400, f'{s} {d}')
s, d = call('PUT', f'/scenarios/{SID}', {'sceneType': 'bogus'}, ADMIN)
check('B7 非法 sceneType → 400', s == 400, f'{s} {d}')
s, d = call('PUT', f'/scenarios/{uuid.uuid4()}', {'name': 'x'}, ADMIN)
check('B8 改不存在场景 → 404', s == 404, f'{s} {d}')
s, d = call('PUT', f'/scenarios/{SID}', {'name': 'y'}, TRAINEE)
check('B9 学员修改 → 403', s == 403, f'{s} {d}')

# 持久化验证：重新 GET 列表
s, d = call('GET', '/scenarios', token=ADMIN)
mine = next((x for x in d['scenarios'] if x['id'] == SID), None)
check('B10 列表中持久化', mine is not None and mine['name'] == 'E2E闭环测试场景-改'
      and mine['successCriteria']['passScore'] == 70 and mine['skillPointIds'] == [SP1],
      json.dumps(mine, ensure_ascii=False)[:200] if mine else 'not found')
check('B11 列表 join 名称', mine is not None and mine.get('personaName') and len(mine.get('skillPointNames', [])) == 1,
      json.dumps({k: mine.get(k) for k in ('personaName', 'skillPointNames')}, ensure_ascii=False) if mine else '')

# ═════════ C. 练习 → 评分闭环 ═════════
print('\n── C. 练习 → 评分闭环 ──')
s, d = call('POST', '/sessions', {'scenarioId': SID, 'mode': 'practice'}, TRAINEE)
check('C1 创建练习会话 201', s == 201, s)
SESS = d['session']['id']
check('C2 开场白为 persona', d['session']['transcript'][0]['speaker'] == 'persona')
check('C3 剩余时长=场景时长', d.get('remainingSeconds') == 5 * 60, d.get('remainingSeconds'))
check('C4 返回场景信息', d.get('scenario', {}).get('name') == 'E2E闭环测试场景-改', d.get('scenario', {}).get('name'))

s, d = call('POST', '/sessions', {'scenarioId': str(uuid.uuid4()), 'mode': 'practice'}, TRAINEE)
check('C5 不存在场景建会话 → 404', s == 404, f'{s} {d}')

s, d = call('GET', f'/sessions/{SESS}', token=TRAINEE)
check('C6 会话详情含场景/角色', s == 200 and d.get('scenario', {}).get('name') == 'E2E闭环测试场景-改'
      and d.get('persona', {}).get('name'), f'{s}')

REPLIES = [
    '您好，我想给孩子报一个数学思维课程，想先了解一下课程效果怎么样？',
    '我们孩子五年级，主要想提升数学思维，你们的价格是怎么收费的？',
    '价格有点贵，效果能保证吗？有没有试听课？',
]
for i, text in enumerate(REPLIES):
    s, d = call('POST', f'/sessions/{SESS}/turns', {'text': text}, TRAINEE)
    check(f'C7.{i+1} 回合 {i+1}', s == 200 and d.get('personaTurn', {}).get('text'), f'{s} {str(d)[:150]}')
    if i < 2: time.sleep(1)

s, d = call('POST', f'/sessions/{SESS}/hint', token=TRAINEE)
check('C8 教练提示', s == 200 and d.get('hintTurn', {}).get('text') and d.get('hintsRemaining') == 2, f'{s} {str(d)[:120]}')

print('   等待 31s 满足最短评分时长…')
time.sleep(31)

s, d = call('POST', f'/sessions/{SESS}/end', token=TRAINEE)
check('C9 结束并评分 200', s == 200, f'{s} {str(d)[:150]}')
report = d.get('report') or {}
check('C10 报告分数范围', isinstance(report.get('totalScore'), (int, float)) and 0 <= report['totalScore'] <= 100,
      report.get('totalScore'))
skill_ids = {x.get('skillPointId') for x in report.get('skillScores', [])}
check('C11 技能分覆盖场景技能点', skill_ids == {SP1}, f'skillScores={skill_ids} 期望={{{SP1}}}')
check('C12 passed 与 passScore 一致', report.get('passed') == (report.get('totalScore', -1) >= 70),
      f"score={report.get('totalScore')} passed={report.get('passed')}")

s, d = call('POST', f'/sessions/{SESS}/end', token=TRAINEE)
check('C13 重复结束 → 409', s == 409, f'{s} {d}')

s, d = call('GET', f'/sessions/{SESS}/review', token=TRAINEE)
check('C14 复盘聚合', s == 200 and d.get('report', {}).get('id') == report.get('id')
      and d.get('scenario', {}).get('id') == SID and d.get('persona'), f'{s} {str(d)[:150]}')
check('C15 复盘 passScore 为最新值', d.get('scenario', {}).get('passScore') == 70, d.get('scenario'))

s, d = call('GET', '/tasks', token=TRAINEE)
check('C16 任务列表 200', s == 200, s)
task = next((t for t in d.get('tasks', []) if t.get('scenarioId') == SID), None)
expect_status = 'passed' if report.get('passed') else 'failed_pending_retry'
check('C17 任务状态与成绩一致', task is not None and task.get('status') == expect_status,
      json.dumps(task, ensure_ascii=False)[:150] if task else 'task not found')

# ═════════ D. 场景修改对新会话生效 ═════════
print('\n── D. 场景修改对闭环的影响 ──')
s, d = call('PUT', f'/scenarios/{SID}', {'durationMinutes': 9, 'name': 'E2E闭环测试场景-再改'}, ADMIN)
check('D1 改时长/名称', s == 200, s)
s, d = call('POST', '/sessions', {'scenarioId': SID, 'mode': 'practice'}, TRAINEE)
check('D2 新会话用新时长', s == 201 and d.get('remainingSeconds') == 9 * 60, f"{s} rem={d.get('remainingSeconds')}")
check('D3 新会话用新名称', d.get('scenario', {}).get('name') == 'E2E闭环测试场景-再改', d.get('scenario', {}).get('name'))
SESS2 = d['session']['id']
s, d = call('GET', f'/sessions/{SESS}/review', token=TRAINEE)
check('D4 旧报告复盘不受改名影响', s == 200 and d.get('report', {}).get('totalScore') == report.get('totalScore'), s)
s, d = call('GET', '/tasks', token=TRAINEE)
task = next((t for t in d.get('tasks', []) if t.get('scenarioId') == SID), None)
check('D5 已通过任务开新练习不回退', task is not None and task.get('status') == expect_status,
      json.dumps(task, ensure_ascii=False)[:150] if task else 'task not found')
# 清理 D2 会话（直接 abandoned 即可，不强求评分）
call('POST', f'/sessions/{SESS2}/end', token=TRAINEE)

# ═════════ E. 场景删除与级联 ═════════
print('\n── E. 场景删除与级联 ──')
s, d = call('POST', '/scenarios', {**BODY, 'name': 'E2E待删场景'}, ADMIN)
SID2 = d['id']
s, d = call('POST', '/sessions', {'scenarioId': SID2, 'mode': 'practice'}, TRAINEE)
SESS3 = d['session']['id']
check('E1 待删场景会话已建', s == 201, s)

s, d = call('DELETE', f'/scenarios/{SID2}', token=TRAINEE)
check('E2 学员删除 → 403', s == 403, f'{s} {d}')
s, d = call('DELETE', f'/scenarios/{SID2}', token=ADMIN)
check('E3 admin 删除 200', s == 200 and d.get('ok'), f'{s} {d}')
s, d = call('DELETE', f'/scenarios/{SID2}', token=ADMIN)
check('E4 重复删除 → 404', s == 404, f'{s} {d}')

s, d = call('GET', '/scenarios', token=ADMIN)
check('E5 列表已移除', all(x['id'] != SID2 for x in d['scenarios']))

s, d = call('POST', '/sessions', {'scenarioId': SID2, 'mode': 'practice'}, TRAINEE)
check('E6 已删场景建会话 → 404', s == 404, f'{s} {d}')

s, d = call('GET', f'/sessions/{SESS3}', token=TRAINEE)
check('E7 已删场景的会话详情降级', s == 200 and d.get('scenario') is None and d.get('session', {}).get('id') == SESS3, f'{s}')

s, d = call('POST', f'/sessions/{SESS3}/turns', {'text': '还在吗'}, TRAINEE)
check('E8 已删场景回合 → 404 场景已被删除', s == 404 and '场景已被删除' in d.get('error', ''), f'{s} {d}')

s, d = call('POST', f'/sessions/{SESS3}/end', token=TRAINEE)
check('E9 已删场景结束会话 → 200 跳过评分', s == 200 and d.get('skippedReport') and d.get('reason') == 'scenario_deleted',
      f'{s} {str(d)[:150]}')
s, d = call('GET', f'/sessions/{SESS3}', token=TRAINEE)
check('E10 会话标记 abandoned（不再是僵尸 active）', d.get('session', {}).get('status') == 'abandoned',
      d.get('session', {}).get('status'))

s, d = call('GET', '/tasks', token=TRAINEE)
check('E11 删场景后任务列表不崩', s == 200, f'{s} {str(d)[:150]}')
dead = next((t for t in d.get('tasks', []) if t.get('scenarioId') == SID2), None)
check('E11b 已删场景任务名降级', dead is None or dead.get('scenarioName') == '（场景已删除）',
      dead.get('scenarioName') if dead else 'no task')

# 清理主场景
s, d = call('DELETE', f'/scenarios/{SID}', token=ADMIN)
check('E12 清理主场景', s == 200, s)
s, d = call('GET', f'/sessions/{SESS}/review', token=TRAINEE)
check('E13 已删场景的复盘降级（报告仍在）', s == 200 and d.get('report', {}).get('totalScore') == report.get('totalScore')
      and d.get('scenario') is None, f'{s} scenario={d.get("scenario")}')

# ═════════ F. 安全与回归新增用例 ═════════
print('\n── F. 归属越权 / persona 部分更新 / 试聊 / 评分标准只读 / description ──')
# F1 水平越权：另一学员不能操作/查看他人会话
uname2 = 'e2e_' + uuid.uuid4().hex[:8]
s, d = call('POST', '/auth/register', {'username': uname2, 'name': 'E2E学员乙', 'password': '123456'})
TRAINEE2 = d['token']
s, d = call('POST', '/scenarios', {**BODY, 'name': 'E2E越权测试场景'}, ADMIN)
SID3 = d['id']
s, d = call('POST', '/sessions', {'scenarioId': SID3, 'mode': 'practice'}, TRAINEE)
SESS4 = d['session']['id']
check('F1.0 越权测试会话已建', s == 201, s)
s, d = call('GET', f'/sessions/{SESS4}', token=TRAINEE2)
check('F1.1 他人会话详情 → 404', s == 404, f'{s} {d}')
s, d = call('POST', f'/sessions/{SESS4}/turns', {'text': '越权发言'}, TRAINEE2)
check('F1.2 他人会话回合 → 404', s == 404, f'{s} {d}')
s, d = call('POST', f'/sessions/{SESS4}/end', token=TRAINEE2)
check('F1.3 他人会话结束 → 404', s == 404, f'{s} {d}')
s, d = call('GET', f'/sessions/{SESS}/review', token=TRAINEE2)
check('F1.4 他人复盘 → 404', s == 404, f'{s} {d}')
s, d = call('POST', f'/sessions/{SESS4}/hint', token=TRAINEE2)
check('F1.5 他人会话提示 → 404', s == 404, f'{s} {d}')
call('POST', f'/sessions/{SESS4}/end', token=TRAINEE)
call('DELETE', f'/scenarios/{SID3}', token=ADMIN)

# F2 persona PUT 部分更新：只传 name 不清空其他字段
s, before = call('GET', f'/persona-configs/{PERSONA}', token=ADMIN)
check('F2.0 读取 persona', s == 200, s)
s, d = call('PUT', f'/persona-configs/{PERSONA}', {'name': before.get('name')}, ADMIN)
check('F2.1 只传 name 更新 200', s == 200, f'{s} {str(d)[:120]}')
s, after = call('GET', f'/persona-configs/{PERSONA}', token=ADMIN)
same = (after.get('elementIds') == before.get('elementIds') and after.get('age') == before.get('age')
        and after.get('behaviorBands') == before.get('behaviorBands')
        and after.get('knowledgeBoundary') == before.get('knowledgeBoundary'))
check('F2.2 elementIds/age/bands/边界保留', s == 200 and same,
      f"elementIds {before.get('elementIds')} → {after.get('elementIds')}, age {before.get('age')} → {after.get('age')}")

# F3 角色试聊 {text, history}
s, d = call('POST', f'/persona-configs/{PERSONA}/trial-chat', {'text': '你好，我想了解课程', 'history': []}, ADMIN)
check('F3.1 试聊 200', s == 200 and bool(d.get('reply')), f'{s} {str(d)[:120]}')
s, d = call('POST', f'/persona-configs/{PERSONA}/trial-chat', {'history': []}, ADMIN)
check('F3.2 缺 text → 400', s == 400, f'{s} {d}')

# F4 评分标准定义：GET 全员可读，写仍限 admin
s, d = call('GET', '/library/score-items', token=TRAINEE)
check('F4.1 学员读评分标准 200', s == 200, f'{s} {str(d)[:100]}')
s, d = call('POST', '/library/score-items', {'name': 'x', 'skillPointId': SP1}, TRAINEE)
check('F4.2 学员写评分标准 → 403', s == 403, f'{s} {d}')

# F5 description 字段闭环
s, d = call('POST', '/scenarios', {**BODY, 'name': 'E2E描述测试', 'description': '客户对孩子成绩很焦虑'}, ADMIN)
check('F5.1 创建带 description', s == 201 and d.get('description') == '客户对孩子成绩很焦虑', f'{s} {d.get("description")}')
SID4 = d.get('id')
s, d = call('GET', '/scenarios', token=ADMIN)
mine4 = next((x for x in d['scenarios'] if x['id'] == SID4), None)
check('F5.2 列表回读 description', mine4 is not None and mine4.get('description') == '客户对孩子成绩很焦虑',
      mine4.get('description') if mine4 else 'not found')
s, d = call('PUT', f'/scenarios/{SID4}', {'description': None}, ADMIN)
check('F5.3 description 可清空', s == 200 and d.get('description') is None, f'{s} {d.get("description")}')
call('DELETE', f'/scenarios/{SID4}', token=ADMIN)

print()
print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAILED: {fails}')
sys.exit(1 if fails else 0)
