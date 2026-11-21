/* Finish-line notices and race announcements use the native timing history.
 * Official cut-adjusted scoring is loaded from 317mx-race-scoring.js.
 */
(function () {
    var oldStart = mxserver.start_handler, oldTiming = mxserver.timing_handler;
    var oldSecond = mxserver.second_handler, oldFinish = mxserver.finish_handler;
    var riders = {}, race = null, track = '', seconds = 0, lastChange = 0;
    var records = {}, trackBests = {}, sessionBest = 0, holeshot = -1, holeTime = 0;
    var holeshotAt = 0, holeAnnounced = false, winnerAnnounced = false, changed = false;
    var recordsFile = '/var/lib/317mx-export/lap-records.json';

    function name(value) {
        return String(value || 'Rider').replace(/[\x00-\x1f\x7f]/g, '').substring(0, 70);
    }
    function clock(ticks) {
        var ms = Math.floor(ticks * 1000 / 128);
        return Math.floor(ms / 60000) + ':' + ('0' + (Math.floor(ms / 1000) % 60)).slice(-2) +
            '.' + ('00' + (ms % 1000)).slice(-3);
    }
    function loadRecords() {
        try { return JSON.parse(mxserver.file_to_string(recordsFile)).tracks || {}; }
        catch (error) { return {}; }
    }
    function livePlayer(slot, rider) {
        return mxserver.get_uid(Number(slot)) === rider.uid && mxserver.get_status(Number(slot)) === 'Player';
    }
    function cleanLap(times, start, end) {
        if (!(times[start] >= race.starttime) || !(times[end] > times[start])) return 0;
        for (var index = start + 1; index <= end; index++) {
            if (!(times[index] >= times[index - 1])) return 0;
        }
        return times[end] - times[start];
    }
    function announceLap(slot, rider, lap, ticks) {
        var known = records[track], age = known ? new Date().getTime() - known.fetchedAt : Infinity;
        if (!(age >= 0 && age < 20 * 60 * 1000)) known = null;
        var bests = trackBests[track];
        if (!bests) bests = trackBests[track] = {time: 0, riders: {}};
        var previous = bests.riders[rider.uid] || 0;
        var officialPersonal = known && known.riders && known.riders[rider.uid];
        var personalBest = (!previous || ticks < previous) && (!officialPersonal || ticks < officialPersonal);
        var serverBest = known && (!known.time || ticks < known.time) && (!bests.time || ticks < bests.time);
        var fastest = !sessionBest || ticks < sessionBest;
        if (personalBest) bests.riders[rider.uid] = ticks;
        if (!bests.time || ticks < bests.time) bests.time = ticks;
        if (fastest) sessionBest = ticks;
        var text = '[ LAP ' + lap + ' COUNTED ] ' + clock(ticks);
        if (serverBest) text += ' \x1b[33m[ NEW SERVER BEST* ]\x1b[0m';
        if (personalBest) text += officialPersonal ? ' \x1b[36m[ PERSONAL BEST* ]\x1b[0m' : ' [ YOUR SESSION BEST ]';
        else text += ' [ NORMAL LAP ]';
        if (serverBest || (personalBest && officialPersonal)) text += ' *PENDING UPLOAD';
        mxserver.send(Number(slot), '\x1b[0m' + text + '\x1b[0m');
        if (serverBest || fastest) {
            var title = serverBest ? (fastest ? 'SESSION FASTEST + SERVER BEST*' : 'NEW SERVER BEST*') : 'SESSION FASTEST';
            mxserver.broadcast('\x1b[0m[ * 317MX * ] \x1b[36m[ ' + title + ' ]\x1b[0m ' +
                rider.name + ' ' + clock(ticks) +
                (serverBest ? ' [ PENDING UPLOAD ]' : '') + '\x1b[0m');
        }
    }
    function checkLaps(scored, final) {
        var pending = false;
        for (var slot in riders) {
            var rider = riders[slot], player = scored.players[slot];
            if (!player || !livePlayer(slot, rider)) continue;
            var completed = mx317RaceScoring.completedLaps(scored, player.times.length);
            for (var lap = 2; lap <= completed; lap++) {
                if (rider.sent[lap]) continue;
                var start = mx317RaceScoring.finishIndex(scored, lap - 1);
                var end = mx317RaceScoring.finishIndex(scored, lap);
                // Only a received finish-line event can produce a lap notice.
                if (typeof player.times[end] !== 'number') continue;
                var ticks = cleanLap(player.times, start, end);
                if (!ticks && !final && seconds - rider.finishAt[lap] < 2) { pending = true; continue; }
                rider.sent[lap] = true;
                if (ticks) announceLap(slot, rider, lap, ticks);
                else mxserver.send(Number(slot), '\x1b[31m[ LAP NOT VALID ]\x1b[0m Lap ' + lap + ' did not count.');
            }
        }
        return pending;
    }
    function authoritativeRace() {
        var raw = mxserver.file_to_string('results.txt'), lines = raw.split(/\r?\n/);
        var parsed = {players: []}, stage = 0, slot = -1, match;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line === 'players:') { stage = 1; continue; }
            if (line === 'times:') { stage = 2; continue; }
            if (!stage && (match = /^(dir|firstlap|normallap|starttime|time|laps)=(.*)$/.exec(line))) {
                parsed[match[1]] = match[1] === 'dir' ? match[2] : Number(match[2]);
            } else if (stage === 1 && (match = /^(slot|uid|name)=(.*)$/.exec(line))) {
                if (match[1] === 'slot') {
                    slot = Number(match[2]);
                    if (!(slot >= 0 && slot < mxserver.max_slots && slot % 1 === 0)) return null;
                    parsed.players[slot] = {uid: 0, name: 'Rider', times: []};
                } else if (slot >= 0) parsed.players[slot][match[1]] =
                    match[1] === 'uid' ? Number(match[2]) : name(match[2]);
            } else if (stage === 2 && (match = /^(\d+) (\d+) (\d+)$/.exec(line))) {
                slot = Number(match[1]);
                var index = Number(match[2]), time = Number(match[3]);
                if (parsed.players[slot] && index <= 8192) parsed.players[slot].times[index] = time;
            }
        }
        if (parsed.dir !== track || parsed.starttime !== race.starttime ||
                parsed.firstlap !== race.firstlap || parsed.normallap !== race.normallap) return null;
        return mx317RaceScoring.score(parsed);
    }
    function checkWinner(scored, final) {
        if (winnerAnnounced || !scored.firstcheckeredtime || !scored.order.length) return;
        if (!final) {
            if (seconds - lastChange < 2) return;
            for (var slot = 0; slot < mxserver.max_slots; slot++) {
                if (mxserver.get_status(slot) !== 'Player') continue;
                var player = scored.players[slot];
                if (!player || mxserver.get_uid(slot) !== player.uid) return;
                var completed = mx317RaceScoring.completedLaps(scored, player.times.length);
                if (!completed) return;
                var finish = player.times[mx317RaceScoring.finishIndex(scored, completed)];
                if (!(finish >= scored.firstcheckeredtime)) return;
            }
        }
        // Re-read the same results file that is submitted to the official index.
        var official = authoritativeRace();
        if (!official || !official.firstcheckeredtime || !official.order.length) return;
        var winner = official.players[official.order[0].index];
        winnerAnnounced = true;
        mxserver.broadcast('\x1b[0m+--- * 317MX * ---+ \x1b[33m[ WINNER ]\x1b[0m ' +
            name(winner.name) + ' WON THE RACE! [ CUT-ADJUSTED RESULTS ] +---+');
    }
    function update(final) {
        if (!race || !track || !(race.firstlap > 0 && race.normallap > 0 && race.laps > 0)) return;
        var start = mxserver.get_number('drop_time');
        if (!(start > 0)) return;
        race.starttime = start;
        var scored = mx317RaceScoring.score(race);
        if (changed || final) changed = checkLaps(scored, final);
        if (!holeAnnounced && holeTime && seconds - holeshotAt >= 2) {
            var winner = null;
            for (var slot in riders) {
                var rider = riders[slot], time = rider.times[holeshot];
                if (time > 0 && (!winner || time < winner.time)) winner = {time: time, name: rider.name};
            }
            if (winner) {
                holeAnnounced = true;
                mxserver.broadcast('\x1b[0m[ * 317MX * ] \x1b[36m[ HOLESHOT ]\x1b[0m ' +
                    winner.name + ' [ FIRST TO THE HOLESHOT LINE ]');
            }
        }
        checkWinner(scored, final);
    }
    mxserver.start_handler = function () {
        if (typeof oldStart === 'function') oldStart.apply(this, arguments);
        riders = {}; seconds = 0; lastChange = 0; sessionBest = 0;
        holeTime = 0; holeshotAt = 0; holeAnnounced = false; winnerAnnounced = false; changed = false;
        track = mxserver.get_string('track_dir');
        holeshot = mxserver.get_number('holeshot_index');
        race = {firstlap: mxserver.get_number('first_lap_length'), normallap: mxserver.get_number('normal_lap_length'),
            time: mxserver.get_number('finish_time'), laps: mxserver.get_number('finish_laps'),
            starttime: mxserver.get_number('drop_time'), players: []};
        records = loadRecords();
    };
    mxserver.timing_handler = function (slot, index, time) {
        if (typeof oldTiming === 'function') oldTiming.apply(this, arguments);
        if (!race || !track || mxserver.get_status(slot) !== 'Player' ||
                !(index >= 0 && index <= 8192 && index % 1 === 0 && time > 0 && time % 1 === 0)) return;
        var uid = mxserver.get_uid(slot);
        if (!(uid > 0)) return;
        var rider = riders[slot];
        if (!rider || rider.uid !== uid) {
            rider = riders[slot] = {uid: uid, name: name((mxserver.get_slot_info(slot) || {}).name),
                times: [], sent: {}, finishAt: {}};
            race.players[slot] = rider;
        }
        rider.times[index] = time;
        var first = race.firstlap, normal = race.normallap;
        if (first > 0 && normal > 0 && index >= first - 1 && (index - first + 1) % normal === 0) {
            var lap = 1 + (index - first + 1) / normal;
            if (typeof rider.finishAt[lap] !== 'number') rider.finishAt[lap] = seconds;
        }
        if (holeshot >= 0 && index === holeshot && (!holeTime || time < holeTime)) {
            if (!holeTime) holeshotAt = seconds;
            holeTime = time;
        }
        changed = true; lastChange = seconds;
    };
    mxserver.second_handler = function () {
        if (typeof oldSecond === 'function') oldSecond.apply(this, arguments);
        seconds++;
        records = loadRecords();
        update(false);
    };
    mxserver.finish_handler = function () {
        update(true);
        if (typeof oldFinish === 'function') oldFinish.apply(this, arguments);
    };
    mxserver.log('317MX race announcements enabled: lap 2+, valid/invalid laps, holeshot, session fastest and cut-adjusted winner.\n');
}());
