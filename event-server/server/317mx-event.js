/* Trusted game-side bridge. Public website signups cannot issue game commands. */
(function () {
    var base = '/var/lib/317mx-events/', owner = 15155, boot = String(new Date().getTime());
    var oldStart = mxserver.start_handler, oldTiming = mxserver.timing_handler;
    var oldSecond = mxserver.second_handler, oldCommand = mxserver.command_handler;
    var oldInfo = mxserver.info_handler, oldReady = mxserver.ready_handler;
    var count = 0, serial = 0, raceSerial = 0, ack = 0, inflight = 0, sentNotices = {}, countdownSent = {};
    var requests = [], control = {}, race = null, riders = {}, qualifying = {}, ready = {}, uidGrab = null;
    function read(path) { try { return JSON.parse(mxserver.file_to_string(base + path)); } catch (e) { return null; } }
    function write(path, value) { mxserver.string_to_file(base + path, JSON.stringify(value)); }
    function text(s) { return String(s || 'Rider').replace(/[\x00-\x1f\x7f]/g, '').substring(0, 70); }
    var previousRequests = read('requests.json');
    if (previousRequests instanceof Array) requests = previousRequests.slice(-100);
    var previousAck = read('ack.json');
    if (previousAck && typeof previousAck.id === 'number') ack = previousAck.id;
    control = read('control.json') || {};
    mxserver._317mx_event_active = control.active === true;
    var notices = control.notices || [];
    for (var ni = 0; ni < notices.length; ni++) sentNotices[notices[ni].id] = true;

    function poll() {
        var next = read('control.json');
        if (!next) return;
        control = next;
        mxserver._317mx_event_active = control.active === true;
        var now = new Date().getTime() / 1000;
        if (!(control.generatedAt > now - 15)) return;
        if (control.countdownAt > now) {
            var remaining = Math.ceil(control.countdownAt - now);
            var countdownKey = control.countdownLabel + ':' + control.countdownAt + ':' + remaining;
            if ([300,120,60,30,10,9,8,7,6,5,4,3,2,1].indexOf(remaining) >= 0 && !countdownSent[countdownKey]) {
                countdownSent[countdownKey] = true;
                var unit = remaining >= 120 ? (remaining / 60) + ' MINUTES' : remaining === 60 ? '1 MINUTE' : remaining + ' SECONDS';
                mxserver.broadcast('\x1b[32m[ 317MX EVENT ]\x1b[33m ' + control.countdownLabel + ' IN ' + unit + '\x1b[0m');
            }
        }
        var action = control.action;
        if (action && typeof action.id === 'number' && action.id > ack && !inflight &&
                action.commands instanceof Array && action.commands.length <= 150) {
            var commands = '#mxserverscript\n';
            for (var i = 0; i < action.commands.length; i++) {
                var line = action.commands[i];
                if (typeof line !== 'string' || /[\r\n]/.test(line) ||
                        !/^(addtrack|removetrack|settrack|maxplayers|lock|unlock|lockgate|unlockgate|forcespec|forceplay|forcegate|broadcast|restart)( |$)/.test(line)) {
                    mxserver.log('317MX event action rejected: invalid command.\n'); return;
                }
                commands += line + '\n';
            }
            commands += '317mx_event_ack ' + action.id + '\n';
            mxserver.string_to_file(base + 'native.txt', commands);
            if (mxserver.file_to_string(base + 'native.txt') !== commands) return;
            inflight = action.id;
            mxserver.schedule_command('at +0 exec ' + base + 'native.txt');
        }
        for (i = 0; i < (control.notices || []).length; i++) {
            var notice = control.notices[i];
            if (sentNotices[notice.id]) continue;
            for (var slot = 0; slot < mxserver.max_slots; slot++) {
                if (mxserver.get_uid(slot) === owner && /^(Player|Spectator)$/.test(mxserver.get_status(slot))) {
                    mxserver.send(slot, '\x1b[33m[ EVENT OWNER ] ' + notice.text + '\x1b[0m');
                    sentNotices[notice.id] = true;
                }
            }
        }
    }
    mxserver.command_handler = function (slot, command) {
        var match = /^317mx_event_ack (\d+)$/.exec(command);
        if (match) {
            if (slot === mxserver.max_slots && Number(match[1]) === inflight) {
                ack = inflight; inflight = 0; write('ack.json', {id: ack});
            }
            return 1;
        }
        match = /^event(?:\s+(.*))?\s*$/i.exec(command);
        if (!match) return typeof oldCommand === 'function' ? oldCommand.apply(this, arguments) : 0;
        if (slot === mxserver.max_slots || mxserver.get_uid(slot) !== owner ||
                !/^(Player|Spectator)$/.test(mxserver.get_status(slot))) {
            if (slot < mxserver.max_slots) mxserver.send(slot, 'Only event owner UID 15155 can use event controls.');
            return 1;
        }
        var value = (match[1] || 'help').toLowerCase();
        if (value.length > 160 || /[^a-z0-9 ._-]/.test(value)) {
            mxserver.send(slot, 'Use server,event help.'); return 1;
        }
        requests.push({id: boot + '-' + (++serial), uid: owner, command: value});
        requests = requests.slice(-100);
        write('requests.json', requests);
        mxserver.send(slot, '\x1b[33m[ EVENT OWNER ] Queued: ' + value + '\x1b[0m');
        return 1;
    };
    mxserver.info_handler = function (slot, message) {
        var match = /^server,\s*(.*)$/i.exec(message);
        if (match && mxserver._317mx_event_active) {
            var command = match[1];
            if (/^(?:callvote|vote|nexttrack|settrack|addtrack|removetrack|exec|at|clearschedule|forcespec|forceplay|forcegate|lockgate|unlockgate|lock|unlock|maxplayers|maxclients)\b/i.test(command)) {
                mxserver.send(slot, '\x1b[33mEvent controls own the lineup and track. Owner: server,event help.\x1b[0m');
                return 1;
            }
            if (/^(restart|norestart)\s*$/i.test(command) && mxserver.get_uid(slot) !== owner) {
                mxserver.send(slot, '\x1b[33mEvent races restart automatically. Owner can pause or rerun the moto.\x1b[0m');
                return 1;
            }
        }
        return typeof oldInfo === 'function' ? oldInfo.apply(this, arguments) : 0;
    };
    mxserver.start_handler = function () {
        if (typeof oldStart === 'function') oldStart.apply(this, arguments);
        riders = {}; ready = {};
        race = {key: boot + '-' + (++raceSerial), track: mxserver.get_string('track_dir'),
            firstlap: mxserver.get_number('first_lap_length'), normallap: mxserver.get_number('normal_lap_length'),
            time: mxserver.get_number('finish_time'), laps: mxserver.get_number('finish_laps'),
            starttime: 0, players: []};
    };
    mxserver.ready_handler = function (slot) {
        if (typeof oldReady === 'function') oldReady.apply(this, arguments);
        var uid = mxserver.get_uid(slot);
        if (uid > 0) ready[uid] = true;
        if (mxserver._317mx_event_active && (control.roster || []).indexOf(uid) >= 0)
            mxserver.schedule_command('at +0 forceplay ' + uid);
        if (mxserver._317mx_event_active) mxserver.send(slot,
            '\x1b[32m[ TEST FUN RACE ]\x1b[33m ' + control.phase +
            ' | Mintop MX | 2 motos: 15 minutes + 1 lap | event info: 317mx.duckdns.org/events.html\x1b[0m');
    };
    mxserver.timing_handler = function (slot, index, ticks) {
        if (typeof oldTiming === 'function') oldTiming.apply(this, arguments);
        if (!race || index < 0 || index > 8192 || index % 1 || !(ticks > 0) || ticks % 1) return;
        var uid = mxserver.get_uid(slot);
        if (!(uid > 0) || mxserver.get_status(slot) !== 'Player') return;
        var info = mxserver.get_slot_info(slot) || {}, p = riders[uid];
        if (!p) {
            p = riders[uid] = {uid: uid, name: text(info.name), times: []};
            race.players[uid] = p;
        }
        p.times[index] = ticks;
        race.starttime = mxserver.get_number('drop_time');
        // Qualifying uses flying laps only, never the opening lap from the start gate.
        if (control.phase !== 'qualifying' || race.track !== 'Mintop' ||
                !(race.firstlap > 0 && race.normallap > 0) || index < race.firstlap + race.normallap - 1 ||
                (index - race.firstlap + 1) % race.normallap !== 0) return;
        var start = index - race.normallap, clean = typeof p.times[start] === 'number', previous = p.times[start];
        for (var i = start + 1; i <= index && clean; i++) {
            if (!(p.times[i] >= previous)) clean = false;
            previous = p.times[i];
        }
        var lap = ticks - p.times[start];
        if (clean && lap > 0 && new Date().getTime() / 1000 <= control.deadline && (!qualifying[uid] || lap < qualifying[uid].ticks))
            qualifying[uid] = {uid: uid, ticks: lap, at: new Date().getTime() / 1000};
    };
    function snapshot() {
        var people = [], catalog = [], i, status, info;
        for (i = 0; i < mxserver.max_slots; i++) {
            status = mxserver.get_status(i);
            if (status !== 'Player' && status !== 'Spectator') continue;
            info = mxserver.get_slot_info(i) || {};
            people.push({uid: mxserver.get_uid(i), name: text(info.name), number: info.number || 0,
                status: status, ready: !!ready[mxserver.get_uid(i)]});
        }
        if (!uidGrab && control.phase === 'qualifying' && control.countdownLabel === 'UID GRAB' &&
                control.countdownAt === control.deadline && new Date().getTime() / 1000 >= control.deadline) {
            uidGrab = {deadline: control.deadline, at: new Date().getTime() / 1000, people: people};
        }
        for (i = 0; i < mxserver.get_number('track_count'); i++) {
            var file = mxserver.get_string('track_list', i), minutes = mxserver.get_number('finish_time_list', i) / 128 / 60;
            var laps = mxserver.get_number('finish_laps_list', i), known = false, dir = '';
            var tracks = mxserver._317mx_rotation_tracks || [];
            for (var j = 0; j < tracks.length; j++) {
                if (tracks[j].file === file) dir = tracks[j].id;
                if (tracks[j].file === file && tracks[j].laps === laps && tracks[j].minutes === minutes) known = true;
            }
            catalog.push({file: file, dir: dir, laps: laps, minutes: minutes, eventTrack: !known});
        }
        var current = null;
        if (race) {
            race.starttime = mxserver.get_number('drop_time');
            var order = [], first = 0;
            if (race.starttime > 0 && race.firstlap > 0 && race.normallap > 0) {
                var scored = mx317RaceScoring.score(race);
                first = scored.firstcheckeredtime || 0;
                for (i = 0; i < scored.order.length; i++) {
                    var result = scored.order[i], p = scored.players[result.index];
                    var completed = mx317RaceScoring.completedLaps(scored, p.times.length);
                    var finish = completed > 0 ? p.times[mx317RaceScoring.finishIndex(scored, completed)] : 0;
                    order.push({uid: p.uid, name: text(p.name), started: p.times.length > 0,
                        finished: !!(first && finish >= first), laps: completed,
                        scoreTime: result.time, position: result.position});
                }
            }
            current = {key: race.key, track: race.track, minutes: race.time / 128 / 60, laps: race.laps,
                firstCheckered: first, order: order, gateDropped: race.starttime > 0};
        }
        var quals = [];
        for (var uid in qualifying) quals.push(qualifying[uid]);
        write('game.json', {schema: 1, generatedAt: new Date().getTime(), boot: boot, ack: ack,
            people: people, uidGrab: uidGrab, catalog: catalog, qualifying: quals, race: current, maxSlots: mxserver.max_slots});
    }
    mxserver.second_handler = function () {
        if (typeof oldSecond === 'function') oldSecond.apply(this, arguments);
        try {
            poll();
            count++; snapshot();
        } catch (error) {
            if (count % 30 === 0) mxserver.log('317MX event bridge storage unavailable.\n');
        }
    };
    mxserver.log('317MX event bridge enabled: owner UID 15155, durable entries, qualifying and event commands.\n');
}());
