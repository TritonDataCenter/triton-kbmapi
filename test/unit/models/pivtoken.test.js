/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Unit tests for PIVTokens model.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const VError = require('verror');

const models = require('../../../lib/models');
const mod_pivtoken = models.pivtoken;
const mod_recovery_configuration = models.recovery_configuration;
const mod_recovery_token = models.recovery_token;

const mod_log = require('../../lib/log');
const mod_server = require('../../lib/server');

const log_child = mod_log.child({
    component: 'test-server'
});

const test = require('tape');

const eboxTpl = fs.readFileSync(path.resolve(
    __dirname, '../../backup'), 'ascii');

var TOKENS = [
    {
        guid: '75CA077A14C5E45037D7A0740D5602A5',
        pin: '12345',
        serial: 'abcd12345',
        model: 'ACME insta-token model 1',
        cn_uuid: '00000000-0000-0000-0000-000000000001',
        pubkeys: {
            /* eslint-disable max-len */
            '9a': 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBC7NhJvp9c5XMOkPLfDvsHZytnY4cWduFRF4KlQIr7LNQnbw50NNlbyhXHzD85KjcztyMoqn9w4XuHdJh4O1lH4=',
            '9d': 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBD+uKKyn5tBNziW21yPt/0FE2LD4l1cWgzONYjn3n8BzSNo/aTzJccki7Q/Lyk7dM8yZLAc/5V/U/QHbLTpexBg=',
            '9e': fs.readFileSync(path.resolve(__dirname, '../../one_token_test_edcsa.pub'), 'ascii')
            /* eslint-enable max-len */
        }
    }
];

test('PIVToken model test', function setup(suite) {
    mod_server.setupMoray(log_child, function setupCb(setupErr, moray) {
        if (setupErr) {
            suite.comment('Skipping tests b/c moray setup failed');
            suite.end(setupErr);
            return;
        }

        var BUCKET;
        var RECOVERY_CONFIG;
        var GUID;
        var RECTOKEN;
        var ETAG;

        suite.test('Init models buckets', function bucket(t) {
            models.init({ moray: moray }, function initCb(err) {
                t.ifError(err, 'Init bucket error');
                if (!err) {
                    BUCKET = true;
                }
                t.end();
            });
        });

        suite.test('Create RecoveryConfiguration', function doCreate(t) {
            if (!BUCKET) {
                t.comment('Skipping tests due to previous failure');
                t.end();
                return;
            }

            mod_recovery_configuration.create({
                moray: moray,
                params: {
                    template: eboxTpl
                }
            }, function createCb(createErr, recCfg) {
                t.ifError(createErr, 'Create Error');
                t.ok(recCfg.params, 'recovery configuration params');
                t.ok(recCfg.params.uuid, 'recovery configuration uuid');
                RECOVERY_CONFIG = recCfg.params.uuid;
                t.end();
            });
        });


        suite.test('Create PIVToken', function doCreate(t) {
            if (!RECOVERY_CONFIG) {
                t.comment('Skipping tests due to previous failure');
                t.end();
                return;
            }

            mod_pivtoken.create({
                moray: moray,
                log: log_child,
                params: Object.assign(TOKENS[0], {
                    recovery_configuration:
                        'f85b894e-d02c-5b1c-b2ea-0564ef55ee24'
                })
            }, function createCb(createErr, pivtoken) {
                t.ifError(createErr, 'Create Error');
                t.ok(pivtoken.params, 'PIVToken params');
                t.ok(pivtoken.params.guid, 'PIVToken uuid');
                GUID = pivtoken.params.guid;
                t.ok(pivtoken.params.recovery_tokens,
                    'PIVToken recovery tokens');
                t.ok(pivtoken.params.created, 'PIVToken created');
                t.ok(pivtoken.etag, 'PIVToken etag');
                ETAG = pivtoken.etag;
                RECTOKEN = pivtoken.params.recovery_tokens[0];
                t.end();
            });
        });


        suite.test('Get PIVToken', function doGet(t) {
            if (!GUID) {
                t.comment('Skipping tests due to previous failure');
                t.end();
                return;
            }

            mod_pivtoken.get({
                moray: moray,
                log: log_child,
                params: {
                    guid: GUID
                }
            }, function getCb(getErr, getPIV) {
                t.ifError(getErr, 'Get error');
                t.ok(getPIV.params, 'pivtoken params');
                t.equal(getPIV.etag, ETAG, 'recovery configuration eTag');
                t.end();
            });
        });


        suite.test('Update PIVToken', function doUpdate(t) {
            if (!GUID) {
                t.comment('Skipping tests due to previous failure');
                t.end();
                return;
            }
            const uuid = '00000000-0000-0000-0000-000000000009';
            mod_pivtoken.update({
                moray: moray,
                params: {
                    guid: GUID
                },
                val: {
                    cn_uuid: uuid
                },
                log: log_child
            }, function (upErr, pivToken) {
                t.ifError(upErr, 'Update error');
                t.ok(pivToken, 'Updated pivToken');
                t.ok(pivToken.etag !== ETAG, 'Etag changed after update');
                t.ok(pivToken.params, 'Updated params');
                t.equal(pivToken.params.cn_uuid, uuid, 'PIVToken UUID');
                t.end();
            });
        });

        suite.test('Update wrong ETAG', function wrongEtag(t) {
            if (!GUID) {
                t.comment('Skipping tests due to previous failure');
                t.end();
                return;
            }
            const uuid = '00000000-0000-0000-0000-000000000008';
            mod_pivtoken.update({
                moray: moray,
                params: {
                    guid: GUID
                },
                val: {
                    cn_uuid: uuid
                },
                remove: true,
                etag: ETAG,
                log: log_child
            }, function (upErr, _pivToken) {
                t.ok(upErr, 'expected update error');
                t.ok(VError.hasCauseWithName(upErr, 'EtagConflictError'),
                    'Expected eTag error');
                t.end();
            });
        });

        suite.test('List PIVTokens', function doList(t) {
            if (!GUID) {
                t.comment('Skipping tests due to previous failure');
                t.end();
                return;
            }
            mod_pivtoken.list({
                moray: moray,
                log: log_child,
                params: {}
            }, function lsCb(lsErr, lsItems) {
                t.ifError(lsErr, 'list error');
                t.ok(Array.isArray(lsItems), 'Array of list items');
                t.equal(lsItems[0].params.guid, GUID, 'Expected gUID');
                t.end();
            });
        });


        suite.test('Avoid duplicate PIVToken', function doDup(t) {
            if (!GUID) {
                t.comment('Skipping tests due to previous failure');
                t.end();
                return;
            }
            mod_pivtoken.create({
                moray: moray,
                log: log_child,
                params: Object.assign(TOKENS[0], {
                    recovery_configuration:
                        'f85b894e-d02c-5b1c-b2ea-0564ef55ee24'
                })
            }, function createCb(createErr, _pivtoken) {
                t.ok(createErr, 'Expected createErr');
                t.ok(VError.hasCauseWithName(createErr, 'EtagConflictError'),
                    'Expected eTag error');
                t.end();
            });
        });


        suite.test('Avoid Delete wrongEtag', function doDelWrongEtag(t) {
            if (!GUID) {
                t.comment('Skipping tests due to previous failure');
                t.end();
                return;
            }
            mod_pivtoken.del({
                moray: moray,
                params: {
                    guid: GUID
                },
                etag: ETAG,
                log: log_child
            }, function (delErr) {
                t.ok(delErr, 'Expected deleteErr');
                t.ok(VError.hasCauseWithName(delErr, 'EtagConflictError'),
                    'Expected eTag error');
                t.end();
            });
        });

        suite.test('Delete Ok', function doDelOk(t) {
            if (!GUID) {
                t.comment('Skipping tests due to previous failure');
                t.end();
                return;
            }
            mod_pivtoken.del({
                moray: moray,
                params: {
                    guid: GUID
                },
                log: log_child
            }, function (delErr) {
                t.ifError(delErr, 'Unexpected delete Error');

                mod_recovery_token.get({
                    moray: moray,
                    params: {
                        uuid: models.uuid(RECTOKEN.token)
                    }
                }, function getCb(getErr) {
                    t.ok(getErr, 'Expected getErr');
                    t.ok(VError.hasCauseWithName(getErr, 'ObjectNotFoundError'),
                    'Expected recovery token to be deleted with PIVToken');
                    t.end();
                });
            });
        });

        suite.test('Stop moray', function stopMoray(t) {
            moray.close();
            mod_server.stopPG();
            t.end();
        });
    });
});

// vim: set softtabstop=4 shiftwidth=4:
