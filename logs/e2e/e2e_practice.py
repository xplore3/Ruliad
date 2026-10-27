# -*- coding: utf-8 -*-
"""E2E：练习页新后端流程 — opening / pause / resume / 暂停期间拒绝回合"""
import json, sys, time, urllib.request

BASE = 'http://localhost:3060/api/v1'
TOKEN = open('logs/e2e/token.txt').read().strip()

def call(method, path, body=None, expect=200):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + TOKEN)
    if data: req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode('utf-8'))

fails = []
def check(name, cond, extra=''):
    print(('PASS' if cond else 'FAIL'), name, extra)
    if not cond: fails.append(name)

# 1. 创建会话
s, d = call('POST', '/sessions', {'scenarioId': 'scenario-first-visit', 'mode': 'practice'}, 201)
check('create session 201', s == 201, str(s))
sid = d['session']['id']
check('opening persona turn exists', d['session']['transcript'][0]['speaker'] == 'persona')
rem0 = d['remainingSeconds']
print('   remainingSeconds =', rem0)

# 2. 教练开场白（文字）
s, d = call('POST', f'/sessions/{sid}/opening')
check('opening 200', s == 200, str(s) + ' ' + json.dumps(d, ensure_ascii=False)[:200])
coach_text = d.get('coachText', '')
print('   coachText =', coach_text)
check('coachText non-empty', bool(coachText := coach_text))

# 3. 再次调用应复用缓存
s, d2 = call('POST', f'/sessions/{sid}/opening')
check('opening cached (same text)', s == 200 and d2.get('coachText') == coach_text)

# 4. 语音模式 opening 应附带音频
s, d3 = call('POST', f'/sessions/{sid}/opening?voice=1')
check('opening voice audio', s == 200 and bool(d3.get('coachAudio')) and bool(d3.get('personaAudio')),
      str(s) + ' coachAudio=%s personaAudio=%s' % (bool(d3.get('coachAudio')), bool(d3.get('personaAudio'))))

# 5. 暂停
time.sleep(2)
s, d = call('POST', f'/sessions/{sid}/pause')
check('pause 200', s == 200, str(s) + ' ' + json.dumps(d)[:120])
rem_paused = d.get('remainingSeconds')

# 6. 暂停期间回合/提示应 409
s1, d1 = call('POST', f'/sessions/{sid}/turns', {'text': '你好'}, 409)
check('turn rejected while paused', s1 == 409 and '暂停' in d1.get('error', ''), str(s1) + ' ' + d1.get('error', ''))
s2, d2 = call('POST', f'/sessions/{sid}/hint')
check('hint rejected while paused', s2 == 409 and '暂停' in d2.get('error', ''), str(s2))

# 7. 会话详情应带 pausedAt
s, d = call('GET', f'/sessions/{sid}')
check('session pausedAt set', bool(d['session'].get('pausedAt')))

# 8. 倒计时冻结：暂停 3 秒后 remainingSeconds 几乎不变
time.sleep(3)
s, d = call('GET', f'/sessions/{sid}')
rem_still = d['remainingSeconds']
check('countdown frozen while paused', rem_still is not None and rem_paused is not None and abs(rem_still - rem_paused) <= 1,
      f'paused={rem_paused} after3s={rem_still}')

# 9. 继续
s, d = call('POST', f'/sessions/{sid}/resume')
check('resume 200', s == 200, str(s) + ' ' + json.dumps(d)[:120])
s, d = call('GET', f'/sessions/{sid}')
check('pausedAt cleared after resume', not d['session'].get('pausedAt'))
check('pausedMs accumulated', d['session'].get('pausedMs', 0) >= 3000, str(d['session'].get('pausedMs')))

# 10. 继续后回合恢复可用
s, d = call('POST', f'/sessions/{sid}/turns', {'text': '你好，我想了解一下产品'})
check('turn works after resume', s == 200, str(s) + ' ' + json.dumps(d, ensure_ascii=False)[:150])
print('   persona reply =', d.get('personaTurn', {}).get('text', '')[:80])

# 11. 重复暂停应 409；结束会话
call('POST', f'/sessions/{sid}/pause')
s, _ = call('POST', f'/sessions/{sid}/pause')
check('double pause 409', s == 409, str(s))
call('POST', f'/sessions/{sid}/resume')
s, d = call('POST', f'/sessions/{sid}/end')
check('end session', s == 200, str(s) + ' skipped=' + str(d.get('skippedReport')))

print()
print('RESULT:', 'ALL PASS' if not fails else f'{len(fails)} FAILED: {fails}')
sys.exit(1 if fails else 0)
