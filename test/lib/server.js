/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const httpSignature = require('http-signature');
const mod_jsprim = require('jsprim');
const moray_sandbox = require('moray-sandbox');

const config = require('./config');
const common = require('./common');
const mod_client = require('./client');
const mod_log = require('./log');

var KBMAPI = require('../../lib/app').KBMAPI;

// --- Globals

var MULTI_SUITE_RUN = false;
var PGHANDLE = null;
var SERVER = null;

function getPG(log, callback) {
    if (PGHANDLE !== null) {
        callback(null, PGHANDLE);
        return;
    } else {
        moray_sandbox.createPG(log, function setHandle(err, pg) {
            if (pg) {
                PGHANDLE = pg;
            }
            callback(err, pg);
        });
    }
}

/**
 * Close the server
 */
function closeServer(t) {
    function done() {
        if (!MULTI_SUITE_RUN) {
            stopPG();
        }

        t.end();
    }

    if (!SERVER) {
        t.pass('no server to close');
        done();
        return;
    }

    SERVER.stop(function (err) {
        SERVER = null;
        t.ifErr(err, 'stopping server');
        done();
    });
}

/**
 * Create the server then end the test
 */
function createServer(t) {
    createTestServer({}, function (err, res) {
        t.ifErr(err, 'creating server');
        if (err) {
            t.end();
            return;
        }

        t.ok(res.server, 'server created');
        t.ok(res.client, 'client created');
        t.end();
    });
}

/**
 * Stops the Postgres server so that it can be cleaned up
 */
function stopPG() {
    if (PGHANDLE !== null) {
        PGHANDLE.stop();
        PGHANDLE = null;
    }
}

/**
 * Create a new Moray instance, spinning up a new Postgres instance if needed.
 */
function setupMoray(log, callback) {
    getPG(log, function spawn(pgErr, pg) {
        if (pgErr) {
            callback(pgErr);
            return;
        }

        pg.spawnMoray(function (err, moray) {
            if (err) {
                callback(err);
                return;
            }

            moray.on('connect', function afterConnect() {
                callback(null, moray);
            });
        });
    });
}

/**
 * Create a test server
 */
function createTestServer(opts, callback) {
    if (SERVER !== null) {
        throw new Error('Cannot run multiple KBMAPI servers at once!');
    }

    var log_child = mod_log.child({
        component: 'test-server'
    });

    var cfg = {
        recoveryTokenDuration: 15 * 60
    };
    var pubkey = path.resolve(__dirname, '../../etc/sdc_key.pub');
    if (fs.existsSync(pubkey)) {
        cfg.SDC_KEY_ID = httpSignature.sshKeyFingerprint(
            fs.readFileSync(pubkey, 'ascii'));
    }

    var kbmapi_config =
        mod_jsprim.mergeObjects(config.server, opts.config || cfg);

    function startWithMoray(err, moray) {
        if (err) {
            callback(err);
            return;
        }

        var server = new KBMAPI({
            config: kbmapi_config,
            log: log_child
        });
        SERVER = server;

        server.moray = moray;

        server.on('initialized', function _afterConnect() {
            log_child.debug('server running');
            var client = common.createClient(SERVER.info().url);
            mod_client.set(client);
            callback(null, { server: SERVER, client: client, moray: moray });
        });

        server.start(function _afterStart() {
            log_child.debug('server started');
        });
    }

    if (opts.moray) {
        startWithMoray(null, opts.moray);
    } else {
        setupMoray(log_child, startWithMoray);
    }
}

module.exports = {
    set MULTI_SUITE_RUN(val) {
        MULTI_SUITE_RUN = val;
    },
    get MULTI_SUITE_RUN() {
        return MULTI_SUITE_RUN;
    },
    _create: createTestServer,
    close: closeServer,
    create: createServer,
    setupMoray: setupMoray,
    stopPG: stopPG,
    get: function () { return SERVER; }
};
