/* Shared ES5 scoring core. Timing positions are zero-based timing-array indexes.
 * Gate indexes begin at zero. Lap ends are first_lap_length - 1, then
 * first_lap_length + normal_lap_length - 1, and so on.
 * Only complete, ordered gate sequences produce a lap time. No race commands.
 */
(function (root) {
    function score(history, first, normal, position, dropTime) {
        var out = {completedLaps: null, lastLapSeconds: null, bestLapSeconds: null};
        if (!(first > 0 && normal > 0 && first % 1 === 0 && normal % 1 === 0) || position == null) return out;
        out.completedLaps = position < first - 1 ? 0 : 1 + Math.floor((position - first + 1) / normal);
        var start = -1, end = first - 1, lap, j, complete, value, previous, startTime;
        for (lap = 0; end <= position && lap < 512; lap++) {
            startTime = start === -1 ? dropTime : history[start];
            complete = typeof startTime === 'number' && isFinite(startTime) && startTime >= 0;
            previous = complete ? startTime : -1;
            for (j = start + 1; j <= end; j++) {
                value = history[j];
                if (typeof value !== 'number' || !isFinite(value) || value < previous) { complete = false; break; }
                previous = value;
            }
            if (complete && history[end] > startTime) {
                value = (history[end] - startTime) / 128;
                out.lastLapSeconds = value;
                if (out.bestLapSeconds === null || value < out.bestLapSeconds) out.bestLapSeconds = value;
            } else { out.lastLapSeconds = null; }
            start = end; end += normal;
        }
        return out;
    }
    root.mx317Score = score;
}(this));

/* Reads current game state and writes a whitelisted snapshot every five seconds.
 * Uses no game commands, administration API, shell, uploads or network sockets.
 * Load scoring.js BEFORE this file, and this file LAST among existing scripts.
 */
(function () {
    if (mxserver._317mx_status_loaded) return;
    mxserver._317mx_status_loaded = true;
    var oldSecond = mxserver.second_handler, oldTiming = mxserver.timing_handler,
        oldStart = mxserver.start_handler, oldDisconnect = mxserver.disconnect_handler,
        timings = {}, ticks = 0;
    function text(value, limit) { return typeof value === 'string' ? value.substring(0, limit) : null; }
    function num(value) { return typeof value === 'number' && isFinite(value) && value >= 0 ? value : null; }
    function setting(name) { try { return num(mxserver.get_number(name)); } catch (e) { return null; } }
    mxserver.start_handler = function () { if (typeof oldStart === 'function') oldStart.apply(this, arguments); timings = {}; };
    mxserver.disconnect_handler = function (slot) { if (typeof oldDisconnect === 'function') oldDisconnect.apply(this, arguments); delete timings[slot]; };
    mxserver.timing_handler = function (slot, pos, time) {
        if (typeof oldTiming === 'function') oldTiming.apply(this, arguments);
        if (!(typeof pos === 'number' && isFinite(pos) && pos >= 0 && pos % 1 === 0 && pos <= 8192 && typeof time === 'number' && isFinite(time) && time >= 0)) return;
        var uid = mxserver.get_uid(slot), state = timings[slot];
        if (!state || state.uid !== uid) state = {uid: uid, history: {}, gate: -1, time: 0, interval: null, at: null};
        state.history[pos] = time;
        if (pos >= state.gate) {
            state.interval = pos === state.gate + 1 && time >= state.time ? (time-state.time)/128 : null;
            state.gate = pos; state.time = time; state.at = new Date().getTime();
        }
        timings[slot] = state;
    };
    mxserver.second_handler = function () {
        if (typeof oldSecond === 'function') oldSecond.apply(this, arguments);
        if (++ticks % 5 !== 0) return;
        try {
            var players = [], order = [], i, info, status, uid, state, score, first = setting('first_lap_length'), normal = setting('normal_lap_length');
            for (i = 0; i < mxserver.max_slots; i++) {
                status = mxserver.get_status(i);
                if (status !== 'Player' && status !== 'Spectator' && status !== 'Zombie') continue;
                try { info = mxserver.get_slot_info(i) || {}; } catch (error) { info = {}; }
                uid = num(mxserver.get_uid(i)); state = timings[i];
                if (!state || state.uid !== uid) state = null;
                score = mx317Score(state ? state.history : {}, first, normal, state ? state.gate : null, setting('drop_time'));
                info = {name: text(info.name,160), number: typeof info.number === 'string' ? text(info.number,16) : num(info.number),
                    uid: uid, status: status, position: null, completedLaps: score.completedLaps,
                    lastLapSeconds: score.lastLapSeconds, bestLapSeconds: score.bestLapSeconds,
                    timingGate: state ? state.gate : null, raceSeconds: state ? state.time/128 : null,
                    gateInterval: state ? state.interval : null, timingAt: state ? state.at : null};
                players.push(info);
                if (status === 'Player' && state) order.push(info);
            }
            order.sort(function(a,b) { return b.timingGate-a.timingGate || a.raceSeconds-b.raceSeconds; });
            for (i=0;i<order.length;i++) order[i].position = i && order[i].timingGate===order[i-1].timingGate && order[i].raceSeconds===order[i-1].raceSeconds ? order[i-1].position : i+1;
            var rotation = typeof mxserver._317mx_rotation_status === 'function' ? mxserver._317mx_rotation_status() : null;
            var trackLoaded = !!mxserver.get_string('track_dir');
            mxserver.string_to_file('/var/lib/317mx-export/status.json', JSON.stringify({schema:1,generatedAt:new Date().getTime(),
                track:text(mxserver.get_string('track_name') || mxserver.get_string('track_dir'),240),
                trackDir:text(mxserver.get_string('track_dir'),240),
                selectedTrackDir:text(mxserver._317mx_selected_track_dir,240),
                race:{minutes:setting('finish_time') / 128 / 60,eventActive:mxserver._317mx_event_active === true,laps:!trackLoaded && rotation ? rotation.laps : setting('finish_laps'),
                    erode:trackLoaded ? setting('erode') / 1024 : null,
                    firstLapGates:first,normalLapGates:normal,positionMethod:'timing-progress'},
                rotation:rotation,players:players,
                trackList:(mxserver._317mx_rotation_tracks || []).map(function (track, index) {
                    return {index:index,id:track.id,name:track.name,laps:track.laps,minutes:track.minutes};
                })}));
        } catch (error) { if(ticks%60===0) mxserver.log('317MX public status export failed; check API and output permissions.'); }
    };
}());
