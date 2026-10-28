# -*- coding: utf-8 -*-
"""E2E 冒烟：本次 4 项修复
1) 考题链路闭环（pendingQuizzes 脱敏下发 + 作答 + 计入评分）
2) hint 注入场景维度（接口可用，输出文案人工观察）
3) hasScript 字段删除（场景接口不再返回该字段，含旧数据残留清理）
4) drill 场景对练不受影响
"""
import json, sys, time, urllib.request, uuid

BASE = 'http://localhost:3060/api/v1'
fails = []

def call(method, path, body=None, token=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if token: req.add_header('Authorization', 'Bearer ' + token)
    if data: req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode('utf-8')
            return r.status, json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8')
        return e.code, json.loads(raw) if raw.strip() else {}

def check(name, cond, extra=''):
    print(('PASS' if cond else 'FAIL'), name, ('| ' + extra) if extra else '')
    if not cond: fails.append(name)

# ---- 0. 账号：学员（练习流程）+ 管理员（考题 CRUD）----
uname = 'e2e-smoke-' + uuid.uuid4().hex[:6]
s, d = call('POST', '/auth/register', {'username': uname, 'name': '冒烟学员', 'password': '123456'})
check('register trainee', s == 201, str(s))
TOKEN = d['token']
s, d = call('POST', '/auth/login', {'username': 'admin1', 'password': '123456'})
check('login admin', s == 200, str(s))
ADMIN = d['token']

# ---- 1. 场景列表：hasScript 已删除（含旧数据残留读出清理）----
s, d = call('GET', '/scenarios', token=TOKEN)
check('list scenarios', s == 200, str(s))
scenarios = d['scenarios'] if isinstance(d, dict) and 'scenarios' in d else d
check('no hasScript in scenario payload', all('hasScript' not in sc for sc in scenarios),
      'leak in: ' + ','.join(sc['id'] for sc in scenarios if 'hasScript' in sc)[:120])
practical = next((sc for sc in scenarios if sc.get('script') and sc['script'].get('executionOrder')), None)
drill = next((sc for sc in scenarios if sc.get('sceneType') == 'drill'), None)
check('found practical scenario with script', practical is not None)
check('found drill scenario', drill is not None)
print('   practical =', practical and practical['id'], practical and practical['name'].encode('unicode_escape').decode()[:40])
print('   drill     =', drill and drill['id'])
SID = practical['id']

# ---- 2. 造一道 turn_count 触发、第 1 轮即弹的考题（admin）----
quiz_body = {
    'scenarioId': SID,
    'type': 'single_choice',
    'prompt': '冒烟题：开场破冰第一步应该做什么？',
    'options': [{'id': 'a', 'label': '直接报价'}, {'id': 'b', 'label': '建立信任与寒暄'}],
    'correctAnswer': ['b'],
    'explanation': '先建立信任再谈业务。',
    'score': 10,
    'trigger': {'kind': 'turn_count', 'afterNTurns': 1},
    'required': False,
}
s, q = call('POST', '/workshop/quiz-questions', quiz_body, ADMIN)
check('create quiz', s in (200, 201), str(s) + ' ' + json.dumps(q, ensure_ascii=False)[:150])
QID = q.get('id')
print('   quiz id =', QID)

# ---- 3. 创建练习会话（响应不应含 hasScript）----
s, d = call('POST', '/sessions', {'scenarioId': SID, 'mode': 'practice'}, TOKEN)
check('create session', s in (200, 201), str(s))
SESS = d['session']['id']
check('session scenario payload has no hasScript', 'hasScript' not in d.get('scenario', {}))

# ---- 4. 第 1 轮发言：应触发考题，且下发为脱敏视图 ----
s, d = call('POST', f'/sessions/{SESS}/turns', {'text': '您好，我想了解一下你们的课程'}, TOKEN)
check('turn 1 ok', s == 200, str(s) + ' ' + json.dumps(d, ensure_ascii=False)[:150])
print('   persona reply =', (d.get('personaTurn') or {}).get('text', '').encode('unicode_escape').decode()[:80])
pq = d.get('pendingQuizzes') or []
check('pendingQuizzes present on turn 1', len(pq) >= 1, json.dumps(pq, ensure_ascii=False)[:200])
hit = next((x for x in pq if x['id'] == QID), None)
check('our quiz in pendingQuizzes', hit is not None)
if hit:
    leaked = [k for k in ('correctAnswer', 'referencePoints', 'explanation', 'trigger', 'tenantId') if k in hit]
    check('quiz sanitized (no answer/trigger leak)', not leaked, 'leaked=' + ','.join(leaked))
    check('quiz public fields', hit.get('prompt') == quiz_body['prompt'] and isinstance(hit.get('options'), list)
          and hit['options'][0].get('id') == 'a' and 'score' in hit and 'required' in hit)

# ---- 5. 作答：先错后对 ----
s, r1 = call('POST', f'/sessions/{SESS}/quiz-answer', {'quizId': QID, 'answer': ['a']}, TOKEN)
check('wrong answer judged incorrect', s == 200 and r1.get('correct') is False and r1.get('score') == 0,
      str(s) + ' ' + json.dumps(r1, ensure_ascii=False)[:120])
check('answer response has explanation+correctAnswer', bool(r1.get('explanation')) and r1.get('correctAnswer') == ['b'])
s, r2 = call('POST', f'/sessions/{SESS}/quiz-answer', {'quizId': QID, 'answer': ['b']}, TOKEN)
check('right answer judged correct +10', s == 200 and r2.get('correct') is True and r2.get('score') == 10,
      str(s) + ' ' + json.dumps(r2, ensure_ascii=False)[:120])

# ---- 6. 第 2 轮：已答考题不再触发 ----
s, d = call('POST', f'/sessions/{SESS}/turns', {'text': '那课程价格是多少呢'}, TOKEN)
check('turn 2 ok', s == 200, str(s))
pq2 = d.get('pendingQuizzes') or []
check('answered quiz not re-triggered', all(x['id'] != QID for x in pq2), json.dumps(pq2)[:120])

# ---- 7. 教练提示（已注入场景维度，文案人工观察）----
s, d = call('POST', f'/sessions/{SESS}/hint', token=TOKEN)
check('hint ok', s == 200 and bool((d.get('hintTurn') or {}).get('text')), str(s))
print('   hint =', (d.get('hintTurn') or {}).get('text', '').encode('unicode_escape').decode())
print('   hintsRemaining =', d.get('hintsRemaining'))

# ---- 8. 结束并评分：报告应含 quizScore（会话需满 30s 才出报告，先等够时长）----
elapsed_ok = False
print('   waiting 32s for report threshold...')
time.sleep(32)
s, d = call('POST', f'/sessions/{SESS}/end', token=TOKEN)
check('end session', s == 200 and not d.get('skippedReport'), str(s) + ' ' + json.dumps(d)[:120])
s, rv = call('GET', f'/sessions/{SESS}/review', token=TOKEN)
check('review ok', s == 200, str(s))
qr = (rv.get('session') or {}).get('quizResults') or []
check('session.quizResults recorded', any(x.get('quizId') == QID and x.get('correct') for x in qr), json.dumps(qr)[:200])
rep = rv.get('report') or {}
qs = rep.get('quizScore')
check('report contains quizScore', qs is not None, json.dumps(qs, ensure_ascii=False) if qs else 'missing')
if qs: check('quizScore earned > 0', qs.get('earned', 0) > 0, json.dumps(qs))

# ---- 9. drill 场景：建会话 + 一轮对练不受影响 ----
s, d = call('POST', '/sessions', {'scenarioId': drill['id'], 'mode': 'practice'}, TOKEN)
check('create drill session', s in (200, 201), str(s))
DSESS = d['session']['id']
s, d = call('POST', f'/sessions/{DSESS}/turns', {'text': '您好，我是课程顾问'}, TOKEN)
check('drill turn ok', s == 200, str(s) + ' ' + json.dumps(d, ensure_ascii=False)[:120])
print('   drill persona reply =', (d.get('personaTurn') or {}).get('text', '').encode('unicode_escape').decode()[:80])
call('POST', f'/sessions/{DSESS}/end', token=TOKEN)

# ---- 10. 清理冒烟考题（admin）----
s, d = call('DELETE', f'/workshop/quiz-questions/{QID}', token=ADMIN)
check('cleanup quiz', s in (200, 204), str(s))

print()
print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAILED: {fails}')
sys.exit(1 if fails else 0)
