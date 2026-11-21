/* Manual restarts with a default track and a three-restart track vote.
 * Admin catalog edits and shared erode survive process restarts.
 */
(function () {
    var config = mx317RotationConfig;
    try { mxserver._317mx_event_active = JSON.parse(mxserver.file_to_string('/var/lib/317mx-events/control.json')).active === true; } catch (eventError) {}
    var prefix = '/var/lib/317mx-export/november-rotation';
    var oldStart = mxserver.start_handler, oldCommand = mxserver.command_handler;
    var oldSecond = mxserver.second_handler, oldInfo = mxserver.info_handler;
    var seconds = 0, fault = false, selectionVersion = 0, appliedVersion = 0;
    var restoring = false, restoreStarted = 0, removedIndexes = {}, additions = [], lastEditor = null;
    var visitTrack = null, restartsRemaining = 0, visitPending = false;

    function validTracks(items) {
        if (!(items instanceof Array) || !items.length || items.length > 1024) return false;
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item || typeof item.file !== 'string' || !item.file ||
                    /[\r\n\x00]/.test(item.file) || typeof item.id !== 'string' || !item.id ||
                    typeof item.name !== 'string' || typeof item.laps !== 'number' ||
                    !(item.laps >= 0 && item.laps % 1 === 0) ||
                    typeof item.minutes !== 'number' || !(item.minutes >= 0 && isFinite(item.minutes)) ||
                    typeof item.interval !== 'number' || !isFinite(item.interval)) return false;
        }
        return true;
    }
    function readState(suffix) {
        try {
            var value = JSON.parse(mxserver.file_to_string(prefix + suffix));
            var count = value.tracks ? (validTracks(value.tracks) ? value.tracks.length : 0) : config.tracks.length;
            if (value.rotation === config.id && typeof value.seq === 'number' && value.seq >= 0 && value.seq % 1 === 0 &&
                    typeof value.index === 'number' && value.index >= 0 && value.index < count && value.index % 1 === 0 &&
                    (value.completed === 0 || value.completed === 1) &&
                    (typeof value.erode === 'undefined' ||
                     (typeof value.erode === 'number' && value.erode >= 0 && value.erode <= 100))) return value;
        } catch (error) {}
        return null;
    }
    var a = readState('-a.json'), b = readState('-b.json');
    var state = a && (!b || a.seq >= b.seq) ? a : b;
    if (!state) state = {rotation: config.id, seq: 0, index: 0, completed: 0};
    var tracks = state.tracks || [];
    if (state.visit && typeof state.visit.index === 'number' &&
            state.visit.index % 1 === 0 && state.visit.index >= 0 && state.visit.index < tracks.length &&
            typeof state.visit.remaining === 'number' && state.visit.remaining % 1 === 0 &&
            state.visit.remaining >= 1 && state.visit.remaining <= 3 &&
            typeof state.visit.pending === 'boolean') {
        visitTrack = tracks[state.visit.index];
        restartsRemaining = state.visit.remaining;
        visitPending = state.visit.pending;
    }
    var globalErode = typeof state.erode === 'number' ? state.erode :
        typeof config.erode === 'number' ? config.erode : 2;
    for (var legacy = 0; legacy < tracks.length; legacy++) delete tracks[legacy].erode;

    function nativeTracks() {
        var items = [];
        for (var i = 0; i < mxserver.get_number('track_count'); i++) {
            items.push({
                file: mxserver.get_string('track_list', i),
                laps: mxserver.get_number('finish_laps_list', i),
                minutes: mxserver.get_number('finish_time_list', i) / 128 / 60
            });
        }
        return items;
    }
    function sameCatalog(nativeList) {
        if (nativeList.length !== tracks.length) return false;
        for (var i = 0; i < nativeList.length; i++) {
            if (nativeList[i].file !== tracks[i].file || nativeList[i].laps !== tracks[i].laps ||
                    nativeList[i].minutes !== tracks[i].minutes) return false;
        }
        return true;
    }
    function describe(item) {
        var text = mxserver.file_to_string(item.file), match = /^dir=(.+)$/m.exec(text);
        var id = match ? match[1].replace(/\r$/, '') : item.file.split(/[\/\\]/).pop().replace(/\.trackinfo$/i, '');
        var name = /^longname=(.+)$/m.exec(text), known = null;
        for (var i = 0; i < config.tracks.length; i++) {
            if (config.tracks[i].id === id) { known = config.tracks[i]; break; }
        }
        return {
            file: item.file, id: id, name: known ? known.name : name ? name[1].replace(/\r$/, '') : id,
            laps: item.laps, minutes: item.minutes, interval: -1
        };
    }
    function save(index) {
        if (!validTracks(tracks)) {
            fault = true;
            mxserver.log('317MX edited track metadata is invalid. Check the saved track list.\n');
            return false;
        }
        var next = {rotation: config.id, seq: state.seq + 1, index: index, completed: 0,
            erode: globalErode, tracks: tracks};
        if (visitTrack) next.visit = {index: tracks.indexOf(visitTrack),
            remaining: restartsRemaining, pending: visitPending};
        var path = prefix + (next.seq % 2 ? '-a.json' : '-b.json');
        var serialized = JSON.stringify(next);
        try {
            mxserver.string_to_file(path, serialized);
            if (mxserver.file_to_string(path) !== serialized) throw new Error('Write verification failed');
            state = next;
            fault = false;
            return true;
        } catch (error) {
            fault = true;
            mxserver.log('317MX rotation changes could not be saved. Check the saved track list.\n');
            return false;
        }
    }
    function writeCommands(path, commands, enqueue) {
        try {
            mxserver.string_to_file(path, commands);
            if (mxserver.file_to_string(path) !== commands) throw new Error('Write verification failed');
        } catch (error) {
            fault = true;
            mxserver.log('317MX rotation commands could not be saved. Check the saved track list.\n');
            return false;
        }
        if (enqueue) mxserver.schedule_command('at +0 exec ' + path);
        return true;
    }
    function defaultIndex() {
        for (var i = 0; i < tracks.length; i++) {
            if (tracks[i].id === config.defaultTrack && tracks[i].laps === 4 && tracks[i].minutes === 0) return i;
        }
        for (i = 0; i < tracks.length; i++) {
            if (tracks[i].id === config.defaultTrack) return i;
        }
        return 0;
    }
    function activeIndex() {
        var dir = mxserver.get_string('track_dir'), laps = mxserver.get_number('finish_laps');
        for (var i = 0; i < tracks.length; i++) {
            if (tracks[i].id === dir && tracks[i].laps === laps) return i;
        }
        return state.index;
    }
    function selectNext() {
        if (mxserver._317mx_event_active) return true;
        var version = selectionVersion + 1;
        var commands = '#mxserverscript\nerode ' + globalErode + '\nsettrack ' + state.index +
            '\n317mx_selection_applied ' + version + '\n';
        if (!writeCommands(prefix + '-selection.txt', commands, true)) return false;
        selectionVersion = version;
        mxserver._317mx_selected_track_dir = tracks[state.index].id;
        return true;
    }
    mxserver.command_handler = function (slot, command) {
        var match = /^317mx_selection_applied (\d+)$/.exec(command);
        if (!match) return typeof oldCommand === 'function' ? oldCommand.apply(this, arguments) : 0;
        if (slot === mxserver.max_slots && Number(match[1]) === selectionVersion) appliedVersion = selectionVersion;
        return 1;
    };
    function synchronize() {
        if (mxserver._317mx_event_active) return;
        var list = nativeTracks();
        if (restoring) {
            if (sameCatalog(list)) { restoring = false; fault = false; }
            else if (seconds - restoreStarted >= 5 && !fault) {
                fault = true;
                mxserver.log('317MX saved track list could not be restored. Check trackinfo files.\n');
            }
            return;
        }
        if (sameCatalog(list)) { removedIndexes = {}; additions = []; return; }
        if (!list.length) { fault = true; return; }
        var previous = tracks, selected = previous[state.index], rebuilt = [], used = {};
        for (var i = 0; i < list.length; i++) {
            var item = null;
            for (var j = 0; j < previous.length; j++) {
                if (!used[j] && !removedIndexes[j] && previous[j].file === list[i].file &&
                        previous[j].laps === list[i].laps && previous[j].minutes === list[i].minutes) {
                    item = previous[j]; used[j] = true; break;
                }
            }
            if (!item) {
                item = describe(list[i]);
                for (j = 0; j < additions.length; j++) {
                    if (additions[j].file === item.file) item.interval = additions[j].interval;
                }
            }
            rebuilt.push(item);
        }
        tracks = rebuilt;
        mxserver._317mx_rotation_tracks = tracks;
        removedIndexes = {}; additions = [];
        if (visitTrack && tracks.indexOf(visitTrack) < 0) {
            visitTrack = null; restartsRemaining = 0; visitPending = false;
        }
        var index = tracks.indexOf(selected);
        if (index < 0) index = defaultIndex();
        if (save(index)) selectNext();
        else {
            state.index = index;
            if (lastEditor !== null) mxserver.send(lastEditor,
                '\x1b[31mTrack edit is active but could not be saved. The server could not save its track list.\x1b[0m');
        }
    }

    var initial = nativeTracks();
    if (!tracks.length) {
        for (var i = 0; i < initial.length; i++) tracks.push(describe(initial[i]));
    } else if (!sameCatalog(initial)) {
        // Add the saved list first because the native engine keeps one track.
        var restoreCommands = '#mxserverscript\n';
        for (i = 0; i < tracks.length; i++) {
            var entry = tracks[i];
            restoreCommands += 'addtrack ' + entry.minutes + ' ' + entry.laps + ' ' +
                entry.interval + ' ' + entry.file + '\n';
        }
        for (i = 0; i < initial.length; i++) restoreCommands += 'removetrack 0\n';
        if (!mxserver._317mx_event_active) restoreCommands += 'exec ' + prefix + '-selection.txt\n';
        writeCommands(prefix + '-restore.txt', restoreCommands, true);
        restoring = true;
        restoreStarted = seconds;
    }
    state.index = visitTrack && (visitPending || restartsRemaining > 1) ?
        tracks.indexOf(visitTrack) : defaultIndex();
    mxserver._317mx_rotation_tracks = tracks;
    mxserver._317mx_rotation_status = function () {
        var loaded = !!mxserver.get_string('track_dir');
        return {
            id: config.id, title: config.title,
            laps: loaded ? mxserver.get_number('finish_laps') : tracks[state.index].laps,
            erode: loaded ? mxserver.get_number('erode') / 1024 : globalErode,
            locked: false, paused: fault
        };
    };

    mxserver.info_handler = function (slot, message) {
        if (typeof oldInfo === 'function' && oldInfo.apply(this, arguments)) return 1;
        var request = /^server,\s*(.*)$/i.exec(message);
        if (!request) return 0;
        var command = request[1], rank = mxserver.get_rank(slot);
        if (/^restart\s*$/i.test(command) && (restoring || appliedVersion !== selectionVersion)) {
            mxserver.send(slot, '\x1b[33mThe next track is being selected. Retry server,restart in a moment.\x1b[0m');
            return 1;
        }
        if (!/^(Admin|Marshal)$/.test(rank) &&
                /^(?:at\s+\S+\s+)*(?:erode|settrack)(?:\s|$)/i.test(command)) {
            mxserver.send(slot, '\x1b[33mUse server,callvote erode # or server,callvote settrack #.\x1b[0m');
            return 1;
        }
        if (!/^(Admin|Marshal)$/.test(rank)) return 0;
        synchronize();
        var match = /^erode\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)\s*$/i.exec(command);
        if (match && isFinite(Number(match[1])) && Number(match[1]) >= 0 && Number(match[1]) <= 100) {
            var oldErode = globalErode;
            globalErode = Number(match[1]);
            if (!save(state.index)) {
                globalErode = oldErode;
                mxserver.send(slot, '\x1b[31mCould not save the erode override. Change was not applied.\x1b[0m');
                return 1;
            }
            selectNext();
        }
        match = /^settrack\s+(\d+)\s*$/i.exec(command);
        if (/^nexttrack\s*$/i.test(command)) match = ['', String((activeIndex() + 1) % tracks.length)];
        if (match && Number(match[1]) < tracks.length) {
            var previousVisit = visitTrack, previousRemaining = restartsRemaining, previousPending = visitPending;
            visitTrack = null; restartsRemaining = 0; visitPending = false;
            if (!save(Number(match[1]))) {
                visitTrack = previousVisit; restartsRemaining = previousRemaining; visitPending = previousPending;
                mxserver.send(slot, '\x1b[31mCould not save the track selection. Change was not applied.\x1b[0m');
                return 1;
            }
            selectNext();
        }
        if (rank === 'Admin') {
            match = /^removetrack\s+(\d+)\s*$/i.exec(command);
            if (match && Number(match[1]) < tracks.length && tracks.length > 1) {
                removedIndexes[Number(match[1])] = true; lastEditor = slot;
            }
            match = /^addtrack\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/i.exec(command);
            if (match && isFinite(Number(match[3]))) {
                additions.push({file: match[4], interval: Number(match[3])}); lastEditor = slot;
            }
        }
        return 0; // Native handlers enforce ranks, validate input and report errors.
    };
    mxserver.start_handler = function () {
        if (mxserver._317mx_event_active) {
            if (typeof oldStart === 'function') oldStart.apply(this, arguments);
            return;
        }
        synchronize();
        // Loading the voted track starts its allowance. Each later race start
        // consumes a restart even if the previous race was unfinished.
        var dir = mxserver.get_string('track_dir');
        if (dir && !restoring) {
            if (visitTrack && dir === visitTrack.id &&
                    mxserver.get_number('finish_laps') === visitTrack.laps &&
                    mxserver.get_number('finish_time') / 128 / 60 === visitTrack.minutes) {
                if (visitPending) visitPending = false;
                else restartsRemaining--;
                if (restartsRemaining <= 0) {
                    visitTrack = null; restartsRemaining = 0;
                }
            } else {
                visitTrack = null; restartsRemaining = 0; visitPending = false;
            }
            var index = visitTrack && restartsRemaining > 1 ? tracks.indexOf(visitTrack) : defaultIndex();
            var erode = mxserver.get_number('erode') / 1024;
            globalErode = erode;
            if (save(index)) selectNext();
        }
        if (typeof oldStart === 'function') oldStart.apply(this, arguments);
        mxserver.log('317MX manual race: ' + dir + ' | laps ' + mxserver.get_number('finish_laps') +
            ' | erode ' + (mxserver.get_number('erode') / 1024).toFixed(3) + '\n');
    };
    mxserver.second_handler = function () {
        if (typeof oldSecond === 'function') oldSecond.apply(this, arguments);
        seconds++;
        synchronize();
    };
    selectNext();
    mxserver._317mx_prepare_vote = function (command) {
        if (mxserver._317mx_event_active) return {error: 'Track and erode voting pause during the event.'};
        synchronize();
        if (fault || restoring) return {error: 'Rotation storage is unavailable. Try again later.'};
        var match = /^settrack (\d+)$/.exec(command);
        if (match && Number(match[1]) < tracks.length)
            return {type: 'settrack', track: tracks[Number(match[1])]};
        match = /^erode (\d+(?:\.\d*)?|\.\d+)$/.exec(command);
        if (match && Number(match[1]) >= 0 && Number(match[1]) <= 100)
            return {type: 'erode', erode: Number(match[1])};
        return {error: 'Invalid track number or erode value (0 to 100).'};
    };
    mxserver._317mx_apply_vote = function (action) {
        if (mxserver._317mx_event_active) return 'Event mode is active.';
        synchronize();
        if (fault || restoring) return 'Rotation storage is unavailable.';
        if (action.type === 'settrack') {
            // Keep the actual entry identity if an owner edits the list during voting.
            var index = tracks.indexOf(action.track);
            if (index < 0) return 'That track was removed during voting.';
            var previousVisit = visitTrack, previousRemaining = restartsRemaining, previousPending = visitPending;
            visitTrack = action.track === tracks[defaultIndex()] ? null : action.track;
            restartsRemaining = visitTrack ? 3 : 0;
            visitPending = !!visitTrack;
            if (!save(index)) {
                visitTrack = previousVisit; restartsRemaining = previousRemaining; visitPending = previousPending;
                return 'The track selection could not be saved.';
            }
        } else if (action.type === 'erode') {
            var previous = globalErode;
            globalErode = action.erode;
            if (!save(state.index)) {
                globalErode = previous;
                return 'The erode setting could not be saved.';
            }
        } else return 'Invalid vote action.';
        return selectNext() ? null : 'Selection could not be queued. Operator attention needed.';
    };
    mxserver.log('317MX admin track controls enabled: manual restarts, three-restart track votes and shared erode.\n');
}());
