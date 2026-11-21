#!/usr/bin/env python3
"""Read-only local HTTP bridge. No third-party packages or game credentials."""
import json
import math
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs
from records import RECORDS
from server_index import SERVER_INDEX
from pathlib import Path

SOURCE = Path(os.environ.get('MX_STATUS_FILE', '/var/lib/317mx-export/status.json'))
MAX_BYTES = 131072
TTL = 45


def clean_text(value, limit):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError('invalid string')
    return ''.join(c for c in value[:limit] if ord(c) >= 32 and ord(c) != 127)


def clean_number(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 2147483647:
        raise ValueError('invalid number')
    return value


def clean_seconds(value):
    if value is None: return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 10000000:
        raise ValueError('invalid timing')
    return value


def validate(data, now):
    if not isinstance(data, dict) or data.get('schema') != 1:
        raise ValueError('schema')
    timestamp = data.get('generatedAt')
    if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp):
        raise ValueError('timestamp')
    age = now - timestamp / 1000
    if age < -5 or age > TTL:
        raise ValueError('stale')
    people = data.get('players')
    if not isinstance(people, list) or len(people) > 256:
        raise ValueError('players')
    players = []
    for p in people:
        if not isinstance(p, dict) or p.get('status') not in ('Player', 'Spectator', 'Zombie'):
            raise ValueError('status')
        n = p.get('number')
        players.append(dict(name=clean_text(p.get('name'), 160),
                            number=clean_text(n, 16) if isinstance(n, str) else clean_number(n),
                            uid=clean_number(p.get('uid')), status=p['status'],
                            timingGate=clean_number(p.get('timingGate')),
                            raceSeconds=clean_seconds(p.get('raceSeconds')),
                            gateInterval=clean_seconds(p.get('gateInterval')),
                            timingAt=clean_timestamp(p.get('timingAt'),now),
                            position=clean_number(p.get('position')),
                            completedLaps=clean_number(p.get('completedLaps')),
                            lastLapSeconds=clean_seconds(p.get('lastLapSeconds')),
                            bestLapSeconds=clean_seconds(p.get('bestLapSeconds'))))
    race=data.get('race') or {}
    if not isinstance(race,dict): raise ValueError('invalid race')
    rotation = data.get('rotation')
    if rotation is not None:
        if not isinstance(rotation, dict):
            raise ValueError('invalid rotation')
        rotation = dict(id=clean_text(rotation.get('id'), 16),
                        title=clean_text(rotation.get('title'), 80),
                        motosPerTrack=clean_number(rotation.get('motosPerTrack')),
                        moto=clean_number(rotation.get('moto')),
                        completedMotos=clean_number(rotation.get('completedMotos')),
                        laps=clean_number(rotation.get('laps')),
                        erode=clean_seconds(rotation.get('erode')),
                        locked=rotation.get('locked') is True,
                        nextTrackDir=clean_text(rotation.get('nextTrackDir'), 240),
                        nextMoto=clean_number(rotation.get('nextMoto')),
                        restartInSeconds=clean_number(rotation.get('restartInSeconds')),
                        paused=rotation.get('paused') is True)
    track_list = data.get('trackList')
    if track_list is not None:
        if not isinstance(track_list, list) or len(track_list) > 1024:
            raise ValueError('invalid track list')
        if any(not isinstance(track, dict) for track in track_list):
            raise ValueError('invalid track entry')
        track_list = [dict(index=clean_number(track.get('index')),
                           id=clean_text(track.get('id'), 240),
                           name=clean_text(track.get('name'), 240),
                           laps=clean_number(track.get('laps')),
                           minutes=clean_seconds(track.get('minutes'))) for track in track_list]
    return dict(generatedAt=timestamp, track=clean_text(data.get('track'), 240),
                trackDir=clean_text(data.get('trackDir'), 240),
                selectedTrackDir=clean_text(data.get('selectedTrackDir'), 240),
                configuredTrack=clean_text(data.get('trackDir') or data.get('selectedTrackDir'),240),
                race=dict(minutes=clean_seconds(race.get('minutes')),eventActive=race.get('eventActive') is True,laps=clean_number(race.get('laps')),erode=clean_seconds(race.get('erode')),
                          firstLapGates=clean_number(race.get('firstLapGates')),
                          normalLapGates=clean_number(race.get('normalLapGates')),positionMethod='timing-progress'),
                rotation=rotation,players=players,trackList=track_list)


def clean_timestamp(value, now):
    if value is None: return None
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0 or value>now*1000+5000:
        raise ValueError('invalid event time')
    return value


class Snapshot:
    def __init__(self, source):
        self.source = source
        self.last = None
        self.next_read = 0
        self.lock = threading.Lock()

    def get(self):
        with self.lock:
            now = time.time()
            if time.monotonic() >= self.next_read:
                self.next_read = time.monotonic() + 5
                try:
                    # Exporter has no atomic-rename API. Ignore partial JSON writes;
                    # preserve the previous VALID timestamp instead of refreshing it.
                    with self.source.open('rb') as stream:
                        raw = stream.read(MAX_BYTES + 1)
                    if len(raw) > MAX_BYTES:
                        raise ValueError('too large')
                    self.last = validate(json.loads(raw), now)
                except (OSError, ValueError, TypeError, OverflowError):
                    pass
            if self.last:
                age = now - self.last['generatedAt'] / 1000
                if -5 <= age <= TTL:
                    return dict(schema=1, state='live', ageSeconds=max(0, round(age, 1)), **self.last)
            return dict(schema=1, state='unavailable', ageSeconds=None, generatedAt=None, track=None, players=[])


CACHE = Snapshot(SOURCE)


class Handler(BaseHTTPRequestHandler):
    server_version = '317MX'
    sys_version = ''

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path not in ('/api/status', '/api/records', '/api/servers') or len(self.path)>300:
            self.send_error(404)
            return
        if parsed.path == '/api/records':
            track = parse_qs(parsed.query).get('track', [None])[0]
            payload = RECORDS.get(track)
        elif parsed.path == '/api/servers':
            payload = SERVER_INDEX.get()
        else:
            payload = CACHE.get()
        data = json.dumps(payload, ensure_ascii=True, allow_nan=False).encode('ascii')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        self.send_error(405)

    def log_message(self, *args):
        pass


class BoundedServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16
    def __init__(self, *args, **kwargs):
        self.workers=threading.BoundedSemaphore(8)
        super().__init__(*args, **kwargs)
    def process_request(self, request, address):
        if not self.workers.acquire(blocking=False):
            try: request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            except OSError: pass
            self.shutdown_request(request)
            return
        try: super().process_request(request,address)
        except Exception:
            self.workers.release()
            raise
    def process_request_thread(self, request, address):
        try: super().process_request_thread(request,address)
        finally: self.workers.release()

if __name__ == '__main__':
    BoundedServer(('127.0.0.1', 8766), Handler).serve_forever()

