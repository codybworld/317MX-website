#!/usr/bin/env python3
"""317MX event entries, archives and UID-paired owner race controls."""
import copy
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from urllib.parse import urlsplit
from event_features import EventFeatures
from owner_http import owner_get, owner_post

ORIGINS = {'https://317mx.duckdns.org', 'https://codybworld.github.io'}


def read_json(path, maximum=2097152):
    with path.open('rb') as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError('File too large')
    return json.loads(raw)


def atomic_json(path, value):
    temp = path.with_name('.' + path.name + '.tmp')
    with temp.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=True, allow_nan=False, separators=(',', ':'))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def plain(value, maximum=80):
    if not isinstance(value, str):
        raise ValueError('Enter text for your name and number.')
    value = ''.join(c for c in value if ord(c) >= 32 and ord(c) != 127).strip()
    if not value or len(value) > maximum:
        raise ValueError('Name or number is missing or too long.')
    return value


def overall(roster, motos):
    rows = []
    for person in roster:
        scores = []
        labels = []
        for moto in ('1', '2'):
            result = next((r for r in motos.get(moto, []) if r['uid'] == person['uid']), None)
            scores.append(result['position'] if result else 41)
            labels.append(result.get('status', 'FIN') if result else 'DNS')
        rows.append(dict(person, moto1=scores[0], moto2=scores[1], statuses=labels,
                         total=sum(scores)))
    rows.sort(key=lambda r: (r['total'], r['moto2'], r['uid']))
    for index, row in enumerate(rows):
        row['position'] = rows[index-1]['position'] if index and (row['total'],row['moto2']) == (rows[index-1]['total'],rows[index-1]['moto2']) else index + 1
    return rows


class Director(EventFeatures):
    def __init__(self, folder, config, clock=time.time):
        self.scheduled = config.get('scheduled', True) is not False
        if not self.scheduled:
            config = dict(id='none', scheduled=False, ownerUid=config.get('ownerUid',15155),
                title='No scheduled event', track='Mintop MX', trackDir='Mintop',
                startsAt=None, displayTime='No scheduled start', pinTrack=False,
                minutes=0, laps=4, motos=0, limit=40, finishWindow=60, intermission=30)
        self.folder, self.config, self.clock = Path(folder), config, clock
        self.folder.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.folder / 'events.sqlite3', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS entries(uid INTEGER PRIMARY KEY,name TEXT,number TEXT,created REAL);
          CREATE TABLE IF NOT EXISTS qualifying(uid INTEGER PRIMARY KEY,ticks INTEGER,at REAL);
          CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY,value TEXT);
          CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,command TEXT,at REAL);
        ''')
        found = self.db.execute('SELECT value FROM state WHERE id=1').fetchone()
        self.state = json.loads(found[0]) if found else dict(phase='qualifying' if self.scheduled else 'idle', armed=self.scheduled,
            automatic=self.scheduled, openedAt=clock(), roster=[], motos={}, queue=[], actionSeq=0,
            notices=[], sent=[], nextKind=None, run=None, boot=None, error=None)
        self.game = None
        self.rates = {}
        self.deadline = datetime.fromisoformat(config['startsAt'].replace('Z', '+00:00')).timestamp() if self.scheduled else 0
        self.init_features()
        self.save()

    def save(self):
        serialized=json.dumps(self.state)
        changed=serialized!=getattr(self,'_saved',None)
        if changed:
            self.db.execute('INSERT OR REPLACE INTO state VALUES(1,?)', (serialized,))
        if self.db.in_transaction: self.db.commit()
        self._saved=serialized
        if not changed and self.clock()-getattr(self,'_heartbeat',0)<3: return
        self._heartbeat=self.clock()
        queued = self.state['queue']
        atomic_json(self.folder / 'control.json', dict(
            active=self.scheduled and self.state['phase'] not in ('idle', 'qualifying', 'complete', 'cancelled'),
            phase=self.state['phase'], action=queued[0] if queued else None,
            eventId=self.config['id'],trackDir=self.config['trackDir'],title=self.config['title'],
            trackName=self.config['track'],pinTrack=self.config['trackDir'] if self.state['pin'] else None,
            roster=[p['uid'] for p in self.state['roster']],
            generatedAt=self.clock(), deadline=self.deadline if self.scheduled else None,
            countdownAt=self.deadline if self.state['phase']=='qualifying' and self.state['armed'] else
                self.state.get('nextAt') if self.state['phase']=='intermission' and self.state['automatic'] else None,
            countdownLabel='UID GRAB' if self.state['phase']=='qualifying' else 'NEXT SESSION',
            notices=self.state['notices'][-30:]))

    def action(self, lines):
        self.state['actionSeq'] += 1
        self.state['queue'].append(dict(id=self.state['actionSeq'], commands=lines))

    def say(self, message):
        self.action(['broadcast \x1b[0m+------------------------------------------------------------+',
            'broadcast \x1b[0m| * 317MX EVENT * | '+message.replace('\n',' ').replace('\r',' '),
            'broadcast \x1b[0m+------------------------------------------------------------+'])

    def reply(self, message):
        self.state['notices'].append(dict(id=str(self.clock()) + '-' + str(len(self.state['notices'])),
                                          text=message))
        self.state['notices'] = self.state['notices'][-30:]

    def entries(self):
        return [dict(row) for row in self.db.execute('''SELECT e.*,q.ticks AS bestTicks,q.at AS bestAt
          FROM entries e LEFT JOIN qualifying q ON e.uid=q.uid ORDER BY e.created,e.uid''')]

    def signup(self, value, ip):
        with self.lock:
            if not self.scheduled or self.state['phase'] != 'qualifying' or self.clock() >= self.deadline:
                raise ValueError('Signups closed. This event has reached its scheduled start time.')
            if not isinstance(value, dict) or isinstance(value.get('uid'), bool):
                raise ValueError('Enter your name, race number and numeric UID.')
            uid = str(value.get('uid', ''))
            if not re.fullmatch(r'[1-9][0-9]{0,7}', uid):
                raise ValueError('Enter a valid numeric UID.')
            uid = int(uid)
            name, number = plain(value.get('name'), 70), plain(value.get('number'), 8)
            if not re.fullmatch(r'[0-9]{1,4}', number):
                raise ValueError('Race number must contain 1 to 4 digits.')
            existing = self.db.execute('SELECT * FROM entries WHERE uid=?', (uid,)).fetchone()
            if existing:
                if existing['name'] == name and existing['number'] == number:
                    return dict(ok=True, message='You are already on the entry list.')
                raise ValueError('This UID is already entered. Ask Cody B to correct the entry.')
            now = self.clock()
            recent = [t for t in self.rates.get(ip, []) if now - t < 3600]
            if len(recent) >= 8 or (recent and now - recent[-1] < 10):
                raise ValueError('Please wait before submitting another entry.')
            if self.db.execute('SELECT count(*) FROM entries').fetchone()[0] >= 512:
                raise ValueError('The entry list is full. Ask Cody B for help.')
            if len(self.rates) > 2000:
                self.rates = {key: times for key, times in self.rates.items() if times and now-times[-1]<3600}
            self.rates[ip] = recent + [now]
            self.db.execute('INSERT INTO entries VALUES(?,?,?,?)', (uid, name, number, now))
            self.db.commit()
            return dict(ok=True, message='Signed up! Join the server and set a clean '+self.config['track']+' lap before UID grab.')

    def fresh(self):
        return bool(self.game and -5 <= self.clock() - self.game.get('generatedAt', 0)/1000 < 12)

    def view(self):
        with self.lock:
            people = {p['uid']: p for p in (self.game or {}).get('people', [])}
            rows = self.entries()
            rows.sort(key=lambda e: (e['bestTicks'] is None, e['bestTicks'] or 0, e['created'], e['uid']))
            qualified = {p['uid'] for p in self.state['roster']}
            fresh = self.fresh()
            for index, row in enumerate(rows):
                p = people.get(row['uid']) if fresh else None
                row.update(qualifyingPosition=index+1 if row['bestTicks'] else None,
                    bestLapSeconds=row['bestTicks']/128 if row['bestTicks'] else None,
                    present=bool(p and p.get('status') in ('Player','Spectator')),
                    qualified=row['uid'] in qualified)
                row.pop('created', None)
            return dict(event=self.config, scheduled=self.scheduled, phase=self.state['phase'], armed=self.state['armed'],
                automatic=self.state['automatic'], entriesOpen=self.scheduled and self.state['phase']=='qualifying' and self.clock()<self.deadline,
                qualifyingOpenedAt=self.state['openedAt'], entries=rows, roster=self.state['roster'],
                motos=self.state['motos'], overall=overall(self.state['roster'], self.state['motos']) if self.state['motos'] else [],
                overallFinal='1' in self.state['motos'] and '2' in self.state['motos'],
                run=self.state['run'], nextKind=self.state.get('nextKind'), nextAt=self.state.get('nextAt'),
                error=self.state.get('error'), live=fresh, updatedAt=self.clock())

    def grab(self):
        if not self.fresh():
            raise ValueError('Live game feed is unavailable; UID grab was not performed.')
        if self.state['phase'] != 'qualifying':
            raise ValueError('UID grab is already complete. Use event add UID for a late rider.')
        people=self.game['people']
        if self.state['armed'] and self.clock()>=self.deadline:
            captured=self.game.get('uidGrab')
            if not captured or captured.get('deadline')!=self.deadline:
                raise ValueError('Waiting for the game server to capture the scheduled UID list.')
            people=captured['people']
        present = {p['uid'] for p in people if p['status'] in ('Player','Spectator')}
        entries = [p for p in self.entries() if p['uid'] in present and p['bestTicks']]
        entries.sort(key=lambda p: (p['bestTicks'], p['created'], p['uid']))
        self.state['roster'] = [{k:p[k] for k in ('uid','name','number')} for p in entries[:40]]
        self.state['armed'] = False
        self.state['grabbedAt'] = self.clock()
        self.state['phase'] = 'paused'
        self.state['error'] = None
        self.state['nextKind'] = 'warmup'
        self.say('UID GRAB COMPLETE - ' + str(len(entries[:40])) + ' qualified riders. Top 40 clean times among signed-up riders present.')
        if not entries:
            self.state['error'] = 'No signed-up riders present with a clean qualifying lap. Owner can use event add UID, then event warmup.'
            self.reply(self.state['error'])
        elif self.state['automatic']:
            self.intermission('warmup', 15)

    def native_catalog(self):
        return (self.game or {}).get('catalog', [])

    def begin(self, kind):
        if self.state['phase']=='starting':raise ValueError('A session start is already pending. Wait for the game acknowledgement.')
        if not self.fresh():
            raise ValueError('A fresh game connection is required before starting a session.')
        if self.state['phase'] == 'qualifying':
            raise ValueError('Run event grab first.')
        if not self.state['roster']:
            raise ValueError('No riders in the roster. Use event add UID.')
        if kind not in ('warmup', 'moto1', 'moto2'):
            raise ValueError('Unknown session.')
        minutes = 0 if kind == 'warmup' else 15
        catalog = self.native_catalog()
        mintop = next((p for p in catalog if p['dir']==self.config['trackDir']), None)
        if not mintop:
            raise ValueError(self.config['track']+' trackinfo is missing from the server.')
        if kind in ('moto1','moto2'):
            self.state['motos'].pop(kind[-1],None)
            if kind=='moto1': self.state['motos'].pop('2',None)
        index = next((i for i,p in enumerate(catalog) if p['dir']==self.config['trackDir'] and p['minutes']==minutes and p['laps']==1), None)
        lines = []
        if index is None:
            index = len(catalog)
            lines.append('addtrack %d 1 -1 %s' % (minutes, mintop['file']))
        lines += ['maxplayers 40', 'lock', 'forcespec ALL']
        for gate,p in enumerate(self.state['roster']):
            lines += ['forceplay '+str(p['uid']), 'forcegate %d %d' % (p['uid'],gate)]
        title = 'LINEUP CHECK / WARMUP' if kind=='warmup' else 'MOTO '+kind[-1]+' - 15 MINUTES + 1 LAP'
        lines += ['lockgate', 'settrack '+str(index), 'broadcast \x1b[0m[ * 317MX EVENT * ] '+title+' ON THIS RESTART\x1b[0m', 'restart']
        self.state['phase'] = 'starting'
        self.state['error'] = None
        self.state['run'] = dict(kind=kind, minutes=minutes, laps=1, requestedAt=self.clock(),
            previousKey=(self.game.get('race') or {}).get('key'), raceKey=None, finishAt=None)
        self.state['nextKind'] = None
        self.action(lines)

    def intermission(self, kind, seconds=None):
        self.state['phase'] = 'intermission'
        self.state['nextKind'] = kind
        self.state['nextAt'] = self.clock() + (self.config['intermission'] if seconds is None else seconds)
        self.state['sent'] = []
        self.say(('LINEUP CHECK / WARMUP' if kind=='warmup' else 'MOTO '+kind[-1]+' - 15 MINUTES + 1 LAP') +
                 ' on restart in '+str(int(self.state['nextAt']-self.clock()))+' seconds.')

    def finalize(self, force=False):
        run = self.state['run']
        race = (self.game or {}).get('race')
        if not self.fresh() or not run or not race or race.get('key') != run.get('raceKey'):
            raise ValueError('Current race results are unavailable. No results were awarded.')
        if not force and not race.get('firstCheckered'):
            raise ValueError('No checkered flag yet.')
        kind = run['kind']
        if kind != 'warmup':
            positions = []
            roster = {p['uid']:p for p in self.state['roster']}
            ordered = [p for p in race.get('order',[]) if p['uid'] in roster and p.get('started')]
            for index,p in enumerate(ordered):
                positions.append(dict(uid=p['uid'],name=roster[p['uid']]['name'],position=index+1,
                    status='FIN' if p.get('finished') else 'DNF'))
            for uid,p in roster.items():
                if not any(row['uid']==uid for row in positions):
                    positions.append(dict(uid=uid,name=p['name'],position=41,status='DNS'))
            self.state['motos'][kind[-1]] = positions
            self.say('MOTO '+kind[-1]+' RESULTS SAVED - overalls: lowest combined positions, Moto 2 breaks ties.')
        else:
            self.say('LINEUP CHECK COMPLETE. Warmup does not score event points.')
        next_kind = 'moto1' if kind=='warmup' else 'moto2' if kind=='moto1' else None
        if next_kind and self.state['automatic']:
            self.intermission(next_kind)
        elif next_kind:
            self.state['phase']='paused'
            self.state['nextKind']=next_kind
        else:
            self.release('complete')

    def release(self, phase):
        # Remove only this controller's temporary event formats, highest index first.
        lines=['unlockgate','unlock']
        for index,p in reversed(list(enumerate(self.native_catalog()))):
            if p['dir']==self.config['trackDir'] and p['laps']==1 and p['minutes'] in (0,15) and p.get('eventTrack'):
                lines.append('removetrack '+str(index))
        base=[p for p in self.native_catalog() if not p.get('eventTrack')]
        default=next((i for i,p in enumerate(base) if p['dir']==self.config['trackDir'] and p['minutes']==0),0)
        lines += ['settrack '+str(default), 'broadcast \x1b[0m[ 317MX EVENT ]\x1b[0m Event '+phase+'. Results: 317mx.duckdns.org/events.html\x1b[0m']
        self.action(lines)
        self.state['phase']='releasing'
        self.state['releaseTo']=phase
        self.state['armed']=False
        self.state['nextKind']=None

    def command(self, command):
        words=command.strip().split()
        if not self.scheduled and words and words[0] not in ('help','status','dashboard','restart'):
            raise ValueError('No event is scheduled. Normal track and erode votes are enabled.')
        if not words or words[0] in ('help','status'):
            self.reply('Normal server mode | Mintop default | track and erode votes enabled' if not self.scheduled else 'Event '+self.state['phase']+' | '+str(len(self.state['roster']))+' riders | auto '+str(self.state['automatic']))
            if not words or words[0]=='help':
                self.reply('server,event dashboard | status | grab | warmup | moto 1/2 | next')
                self.reply('pause | resume | auto on/off | add UID | remove UID | finish | rerun')
                self.reply('result MOTO UID POS | end | arm | disarm | pin on/off | restart')
            return
        verb=words[0]
        if verb=='dashboard' and len(words)==1:
            code=self.auth.issue()
            self.reply('Dashboard: 317mx.duckdns.org/race-control.html')
            self.reply('Private dashboard code: '+code+' (expires in 5 minutes)')
            return
        elif verb=='dashboard' and words[1:]==['logout']:
            self.auth.revoke();self.reply('All dashboard sessions revoked.');return
        elif verb=='pin' and len(words)==2 and words[1] in ('on','off'):
            if self.state['phase'] not in ('qualifying','complete','cancelled'):raise ValueError('End event control before changing the qualifying pin')
            self.state['pin']=words[1]=='on'
        elif verb=='restart' and len(words)==1:
            self.action(['restart'])
        elif verb in ('arm','disarm') and len(words)==1:
            if self.state['phase']!='qualifying': raise ValueError('UID grab already complete.')
            if verb=='arm' and self.clock()>=self.deadline: raise ValueError('Start time passed; use event grab.')
            self.state['armed']=verb=='arm'
        elif verb=='grab' and len(words)==1: self.grab()
        elif verb=='warmup' and len(words)==1: self.begin('warmup')
        elif verb=='moto' and len(words)==2 and words[1] in ('1','2'):
            if words[1]=='2' and '1' not in self.state['motos']: raise ValueError('Complete Moto 1 first.')
            self.begin('moto'+words[1])
        elif verb=='next' and len(words)==1:
            kind=self.state.get('nextKind')
            if not kind: raise ValueError('No next session queued. Use event warmup or event moto 1/2.')
            self.begin(kind)
        elif verb=='auto' and len(words)==2 and words[1] in ('on','off'):
            self.state['automatic']=words[1]=='on'
        elif verb=='pause' and len(words)==1:
            if self.state['phase']=='qualifying':
                self.state['armed']=False
                self.reply('Scheduled UID grab disarmed. Qualifying remains open until its deadline.')
                return
            self.state['pausedFrom']=self.state['phase']
            self.state['phase']='paused'
            self.state['error']='Owner paused event progression. Racing itself is not frozen.'
            self.say('Owner paused event progression. Current race may continue.')
        elif verb=='resume' and len(words)==1:
            if self.state['phase']!='paused': raise ValueError('The event is not paused.')
            run=self.state.get('run')
            race=(self.game or {}).get('race')
            previous=self.state.get('pausedFrom')
            if run and race and race.get('key')==run.get('raceKey') and previous in ('warmup','moto1','moto2'):
                self.state['phase']=previous
            elif self.state.get('nextKind'): self.intermission(self.state['nextKind'],15)
            elif run: self.begin(run['kind'])
            else: raise ValueError('Use event warmup after adding entrants.')
            self.state['error']=None
        elif verb in ('add','remove') and len(words)==2 and re.fullmatch(r'[1-9][0-9]{0,7}',words[1]):
            uid=int(words[1])
            if self.state['phase'] in ('qualifying','complete','cancelled','releasing'):
                raise ValueError('Use event grab first; roster changes are for the active event.')
            if verb=='add':
                if any(p['uid']==uid for p in self.state['roster']):
                    self.action(['forceplay '+str(uid)])
                    self.reply('UID already selected; player mode restored for the next restart.')
                    return
                if len(self.state['roster'])>=40: raise ValueError('40 riders already selected. Remove a rider first.')
                entry=self.db.execute('SELECT * FROM entries WHERE uid=?',(uid,)).fetchone()
                person=next((p for p in (self.game or {}).get('people',[]) if p['uid']==uid),None)
                if not entry and not person: raise ValueError('UID must be signed up or connected.')
                p=dict(entry) if entry else dict(uid=uid,name=person['name'],number=str(person.get('number') or '0'))
                if not entry:
                    self.db.execute('INSERT INTO entries VALUES(?,?,?,?)',(uid,p['name'],p['number'],self.clock()))
                self.state['roster'].append({k:p[k] for k in ('uid','name','number')})
                self.action(['forceplay '+str(uid)])
            else:
                self.state['roster']=[p for p in self.state['roster'] if p['uid']!=uid]
                self.action(['forcespec '+str(uid)])
        elif verb=='finish' and len(words)==1: self.finalize(force=True)
        elif verb=='rerun' and len(words)==1:
            if not self.state.get('run'): raise ValueError('No session to rerun.')
            self.begin(self.state['run']['kind'])
        elif verb=='result' and len(words)==4 and words[1] in ('1','2') and all(w.isdigit() for w in words[2:]):
            uid,pos=int(words[2]),int(words[3]); rows=self.state['motos'].get(words[1],[])
            row=next((p for p in rows if p['uid']==uid),None)
            if not row or not 1<=pos<=41: raise ValueError('Use a UID in the saved moto and a position from 1 to 41 (DNS).')
            other=next((p for p in rows if p['position']==pos and p['uid']!=uid),None)
            if other and pos<41: other['position']=row['position']; other['adjusted']=True
            row.update(position=pos, adjusted=True, status='DNS' if pos==41 else 'ADJ')
        elif verb=='end' and len(words)==1: self.release('cancelled')
        else: raise ValueError('Unknown command. Use server,event help.')
        self.reply('Event command accepted: '+command)

    def tick(self):
        with self.lock:
            now=self.clock()
            try:
                game=read_json(self.folder/'game.json')
                if isinstance(game,dict) and game.get('schema')==1: self.game=game
            except (OSError,ValueError,TypeError): pass
            if self.fresh():
                boot=self.game.get('boot')
                if self.state['boot'] and boot!=self.state['boot'] and self.state['phase'] not in ('idle','qualifying','complete','cancelled'):
                    self.state['queue']=[]
                    self.state['phase']='paused'
                    self.state['error']='Game server restarted. Owner: use event resume or event rerun.'
                    self.reply(self.state['error'])
                self.state['boot']=boot
                ack=self.game.get('ack',0)
                self.state['queue']=[a for a in self.state['queue'] if a['id']>ack]
                if self.state['phase']=='releasing' and not self.state['queue']:
                    self.state['phase']=self.state.pop('releaseTo')
                if self.state['phase']=='qualifying':
                    for lap in self.game.get('qualifying',[]):
                        if lap['at'] < self.state['openedAt'] or lap['at'] > self.deadline: continue
                        old=self.db.execute('SELECT ticks FROM qualifying WHERE uid=?',(lap['uid'],)).fetchone()
                        if not old or lap['ticks']<old[0]:
                            self.db.execute('INSERT OR REPLACE INTO qualifying VALUES(?,?,?)',(lap['uid'],lap['ticks'],lap['at']))
            try:
                requests=read_json(self.folder/'requests.json',131072)
                for request in requests[-100:]:
                    if request.get('eventId') not in (None,self.config['id']): continue
                    if request.get('uid')!=self.config['ownerUid'] or not isinstance(request.get('command'),str): continue
                    rid=str(request.get('id',''))[:100]
                    if not rid or self.db.execute('SELECT 1 FROM requests WHERE id=?',(rid,)).fetchone(): continue
                    self.db.execute('INSERT INTO requests VALUES(?,?,?)',(rid,request['command'][:200],now))
                    try: self.command(request['command'][:200])
                    except ValueError as error: self.reply(str(error))
            except (OSError,ValueError,TypeError): pass
            if self.state['phase']=='qualifying' and self.state['armed']:
                remaining=self.deadline-now
                if remaining<=0:
                    try: self.grab()
                    except ValueError as error: self.state['error']=str(error)
            if self.state['phase']=='intermission' and self.state['automatic']:
                remaining=self.state['nextAt']-now
                if remaining<=0:
                    try: self.begin(self.state['nextKind'])
                    except ValueError as error: self.state.update(phase='paused',error=str(error))
            race=(self.game or {}).get('race')
            run=self.state.get('run')
            if self.state['phase']=='starting' and run and self.fresh():
                if race and race.get('key')!=run['previousKey'] and race.get('track')==self.config['trackDir'] and race.get('minutes')==run['minutes'] and race.get('laps')==1:
                    run['raceKey']=race['key']; run['startedAt']=now
                    self.state['phase']=run['kind']
                elif now-run['requestedAt']>180:
                    self.state.update(phase='paused',error='Session did not load in time. Owner: event resume or event rerun.')
            if self.state['phase'] in ('warmup','moto1','moto2') and run and self.fresh():
                if not race or race.get('key')!=run['raceKey']:
                    self.state.update(phase='paused',pausedFrom=run['kind'],error='Race restarted before results were saved. Use event rerun; no results were awarded.')
                    self.reply(self.state['error'])
                elif race.get('firstCheckered'):
                    if run['finishAt'] is None:
                        run['finishAt']=now
                        self.say('Checkered flag! Up to 60 seconds for remaining riders before results are saved.')
                    starters=[p for p in race.get('order',[]) if p.get('started') and any(r['uid']==p['uid'] for r in self.state['roster'])]
                    all_done=starters and all(p.get('finished') for p in starters)
                    if now-run['finishAt']>=self.config['finishWindow'] or (all_done and now-run['finishAt']>=5):
                        self.finalize()
                elif now-run.get('startedAt',now)>(420 if run['kind']=='warmup' else 1500):
                    self.state.update(phase='paused',pausedFrom=run['kind'],error='Session timed out without a finisher. Use event finish or event rerun.')
                    self.reply(self.state['error'])
            self.save()

    def countdown(self, remaining, label):
        thresholds=[300,120,60,30,10,9,8,7,6,5,4,3,2,1]
        if remaining<=0: return
        # Only announce a threshold in its own second; delayed ticks do not flood chat.
        second=int(remaining+0.999)
        key=label+':'+str(second)
        if second in thresholds and key not in self.state['sent']:
            self.state['sent'].append(key)
            text=str(second//60)+' MINUTES' if second>=120 else '1 MINUTE' if second==60 else str(second)+' SECONDS'
            self.say(label+' IN '+text)


DIRECTOR=None


class Handler(BaseHTTPRequestHandler):
    server_version='317MX'; sys_version=''

    def setup(self):
        super().setup(); self.connection.settimeout(5)

    def send_json(self, status, value, extra=None):
        data=json.dumps(value,ensure_ascii=True,allow_nan=False).encode()
        self.send_response(status)
        for key,val in (extra or {}).items(): self.send_header(key,val)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        origin=self.headers.get('Origin')
        if origin in ORIGINS:
            self.send_header('Access-Control-Allow-Origin',origin)
            self.send_header('Vary','Origin')
        self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        path=urlsplit(self.path).path
        if len(self.path)>250:return self.send_json(404,dict(error='Not found'))
        if path.startswith('/api/events/owner'):return owner_get(self,DIRECTOR)
        if path=='/api/events':return self.send_json(200,DIRECTOR.index())
        match=re.fullmatch(r'/api/events/([a-zA-Z0-9-]{1,80})',path)
        with DIRECTOR.lock:
            event=DIRECTOR.public_event(match[1]) if match else None
        self.send_json(200 if event else 404,event or dict(error='Not found'))

    def do_OPTIONS(self):
        if self.headers.get('Origin') not in ORIGINS:
            return self.send_json(403,dict(error='Origin not allowed'))
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin',self.headers['Origin'])
        self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.send_header('Vary','Origin')
        self.send_header('Content-Length','0'); self.end_headers()

    def do_POST(self):
        if urlsplit(self.path).path.startswith('/api/events/owner'):return owner_post(self,DIRECTOR)
        if urlsplit(self.path).path!='/api/events/'+DIRECTOR.config['id']+'/signup':
            if re.fullmatch(r'/api/events/[a-zA-Z0-9-]+/signup',urlsplit(self.path).path):
                return self.send_json(400,dict(error='Signups closed for this event.'))
            return self.send_json(404,dict(error='Not found'))
        if self.headers.get('Origin') not in ORIGINS and self.headers.get('Origin'):
            return self.send_json(403,dict(error='Origin not allowed'))
        if self.headers.get_content_type()!='application/json':
            return self.send_json(415,dict(error='Use application/json'))
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=2048: raise ValueError('Invalid request size')
            value=json.loads(self.rfile.read(size))
            # Nginx replaces this header, so callers cannot choose their rate-limit identity.
            ip=self.headers.get('X-Real-IP') or self.client_address[0]
            result=DIRECTOR.signup(value,ip)
        except (ValueError,TypeError,OverflowError) as error:
            return self.send_json(400,dict(error=str(error)))
        self.send_json(200,result)

    def log_message(self,*args): pass


class Server(ThreadingHTTPServer):
    daemon_threads=True
    request_queue_size=16
    def __init__(self,*args,**kwargs):
        self.slots=threading.BoundedSemaphore(8)
        super().__init__(*args,**kwargs)
    def process_request(self,request,address):
        if not self.slots.acquire(False):
            request.close(); return
        try: super().process_request(request,address)
        except Exception: self.slots.release(); raise
    def process_request_thread(self,request,address):
        try: super().process_request_thread(request,address)
        finally: self.slots.release()


def main():
    global DIRECTOR
    folder=Path(os.environ.get('MX_EVENT_DIR','/var/lib/317mx-events'))
    config=read_json(Path(__file__).with_name('event.json'))
    DIRECTOR=Director(folder,config)
    def worker():
        while True:
            try: DIRECTOR.tick()
            except Exception as error:
                print('Event director error: '+type(error).__name__,flush=True)
            time.sleep(1)
    threading.Thread(target=worker,daemon=True).start()
    Server(('127.0.0.1',8767),Handler).serve_forever()


if __name__=='__main__': main()
