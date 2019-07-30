/*-----------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Licensed under the MIT License. See LICENSE file in the project root for license information.
 *-----------------------------------------------------------------------------------------------*/

import { CliExitData, Cli } from '../src/cli';
import * as assert from 'assert';
import * as sinon from 'sinon';
import { ToolsConfig } from '../src/tools';
import * as vscode from 'vscode';
import * as shelljs from 'shelljs';
import { Platform } from '../src/util/platform';
import { Archive } from '../src/util/archive';
import * as path from 'path';
import * as fs from 'fs';
import * as fsex from 'fs-extra';
import hasha = require("hasha");

suite("tool configuration", () => {
    let sb: sinon.SinonSandbox;
    let chmodSyncStub: sinon.SinonStub;

    setup(() => {
        sb = sinon.createSandbox();
        chmodSyncStub = sb.stub(fs, 'chmodSync');
        ToolsConfig.resetConfiguration();
    });

    teardown(() => {
        sb.restore();
    });

    suite('getVersion()', () => {
        test('returns version number with expected output', async () => {
            const testData: CliExitData = { stdout: 'tkn v0.1.2 (43e2a41)\n line two', stderr: '', error: undefined };
            sb.stub(Cli.prototype, 'execute').resolves(testData);
            sb.stub(fs, 'existsSync').returns(true);

            const result: string = await ToolsConfig.getVersion('tkn');
            assert.equal(result, '0.1.2');
        });

        test('returns version undefined for unexpected output', async () => {
            const invalidData: CliExitData = { error: undefined, stderr: '', stdout: 'tknunexpected v0.1.2 (43e2a41) \n line two' };
            sb.stub(Cli.prototype, 'execute').resolves(invalidData);
            sb.stub(fs, 'existsSync').returns(true);

            const result: string = await ToolsConfig.getVersion('tkn');
            assert.equal(result, undefined);
        });

        test('returns version undefined for not existing tool', async () => {
            const invalidData: CliExitData = { error: undefined, stderr: '', stdout: 'tknunexpected v0.1.2 (43e2a41) \n line two' };
            sb.stub(Cli.prototype, 'execute').resolves(invalidData);
            sb.stub(fs, 'existsSync').returns(false);

            const result: string = await ToolsConfig.getVersion('tkn');
            assert.equal(result, undefined);
        });

        test('returns version undefined for tool that does not support version parameter', async () => {
            const invalidData: CliExitData = { error: new Error('something bad happened'), stderr: '', stdout: 'tknunexpected v0.1.2 (43e2a41) \n line two' };
            sb.stub(Cli.prototype, 'execute').resolves(invalidData);
            sb.stub(fs, 'existsSync').returns(true);

            const result: string = await ToolsConfig.getVersion('tkn');
            assert.equal(result, undefined);
        });
    });

    suite('detectOrDownload()', () => {
        let withProgress;

        setup(() => {
            withProgress = sb.stub(vscode.window, 'withProgress').resolves();
        });

        test('returns path to tool detected form PATH ltknations if detected version is correct', async () => {
            sb.stub(shelljs, 'which').returns(<string & shelljs.ShellReturnValue>{stdout: 'tkn'});
            sb.stub(fs, 'existsSync').returns(false);
            sb.stub(ToolsConfig, 'getVersion').returns(ToolsConfig.tool['tkn'].version);
            const tooltknation = await ToolsConfig.detectOrDownload();
            assert.equal(tooltknation, 'tkn');
        });

        test('returns path to previously downloaded tool if detected version is correct', async () => {
            sb.stub(shelljs, 'which');
            sb.stub(fs, 'existsSync').returns(true);
            sb.stub(ToolsConfig, 'getVersion').returns(ToolsConfig.tool['tkn'].version);
            const toolLtknation = await ToolsConfig.detectOrDownload();
            assert.equal( toolLtknation, path.resolve(Platform.getUserHomePath(), '.vs-tekton', ToolsConfig.tool['tkn'].cmdFileName));
        });

        test('ask to download tool if previously downloaded version is not correct and download if requested by user', async () => {
            sb.stub(shelljs, 'which');
            sb.stub(fs, 'existsSync').returns(true);
            sb.stub(ToolsConfig, 'getVersion').resolves('0.0.0');
            const showInfo = sb.stub(vscode.window, 'showInformationMessage').resolves(`Download and install v${ToolsConfig.tool['tkn'].version}`);
            const stub = sb.stub(hasha, 'fromFile').onFirstCall().returns(ToolsConfig.tool['tkn'].sha256sum);
            stub.onSecondCall().returns(ToolsConfig.tool['tkn'].sha256sum);
            sb.stub(Archive, 'unzip').resolves();
            let toolLtknation = await ToolsConfig.detectOrDownload();
            assert.ok(showInfo.calledOnce);
            assert.ok(withProgress.calledOnce);
            assert.equal( toolLtknation, path.resolve(Platform.getUserHomePath(), '.vs-tekton', ToolsConfig.tool['tkn'].cmdFileName));
            showInfo.resolves(`Download and install v${ToolsConfig.tool['tkn'].version}`);
            toolLtknation = await ToolsConfig.detectOrDownload();
            assert.ok(showInfo.calledTwice);
            assert.ok(withProgress.calledTwice);
            assert.equal( toolLtknation, path.resolve(Platform.getUserHomePath(), '.vs-tekton', ToolsConfig.tool['tkn'].cmdFileName));
        });

        test('ask to download tool if previously downloaded version is not correct and skip download if canceled by user', async () => {
            sb.stub(shelljs, 'which');
            sb.stub(fs, 'existsSync').returns(true);
            sb.stub(ToolsConfig, 'getVersion').resolves('0.0.0');
            const showInfo = sb.stub(vscode.window, 'showInformationMessage').resolves('Cancel');
            const toolLtknation = await ToolsConfig.detectOrDownload();
            assert.ok(showInfo.calledOnce);
            assert.equal(toolLtknation, undefined);
        });

        test('downloads tool, ask to download again if checksum does not match and finish if consecutive download successful', async () => {
            sb.stub(shelljs, 'which');
            sb.stub(fs, 'existsSync').returns(true);
            sb.stub(ToolsConfig, 'getVersion').resolves('0.0.0');
            const showInfo = sb.stub(vscode.window, 'showInformationMessage').onFirstCall().resolves(`Download and install v${ToolsConfig.tool['tkn'].version}`);
            showInfo.onSecondCall().resolves('Download again');
            const fromFile = sb.stub(hasha, 'fromFile').onFirstCall().resolves('not really sha256');
            fromFile.onSecondCall().returns(ToolsConfig.tool['tkn'].sha256sum);
            sb.stub(fsex, 'removeSync');
            sb.stub(Archive, 'unzip').resolves();
            const toolLtknation = await ToolsConfig.detectOrDownload();
            assert.ok(withProgress.calledTwice);
            assert.ok(showInfo.calledTwice);
            assert.equal( toolLtknation, path.resolve(Platform.getUserHomePath(), '.vs-tekton', ToolsConfig.tool['tkn'].cmdFileName));
        });

        test('downloads tool, ask to download again if checksum does not match and exits if canceled', async () => {
            sb.stub(shelljs, 'which');
            sb.stub(fs, 'existsSync').returns(true);
            sb.stub(ToolsConfig, 'getVersion').resolves('0.0.0');
            const showInfo = sb.stub(vscode.window, 'showInformationMessage').onFirstCall().resolves(`Download and install v${ToolsConfig.tool['tkn'].version}`);
            showInfo.onSecondCall().resolves('Cancel');
            const fromFile = sb.stub(hasha, 'fromFile').onFirstCall().resolves('not really sha256');
            fromFile.onSecondCall().returns(ToolsConfig.tool['tkn'].sha256sum);
            sb.stub(fsex, 'removeSync');
            sb.stub(Archive, 'unzip').resolves();
            const toolLtknation = await ToolsConfig.detectOrDownload();
            assert.ok(withProgress.calledOnce);
            assert.ok(showInfo.calledTwice);
            assert.equal(toolLtknation, undefined);
        });

        suite('on windows', () => {
            setup(() => {
                sb.stub(Platform, 'getOS').returns('win32');
                sb.stub(Platform, 'getEnv').returns({
                    USERPROFILE: 'profile'
                });
                ToolsConfig.resetConfiguration();
            });

            test('does not set executable attribute for tool file', async () => {
                sb.stub(shelljs, 'which');
                sb.stub(fs, 'existsSync').returns(true);
                sb.stub(fsex, 'ensureDirSync').returns();
                sb.stub(ToolsConfig, 'getVersion').resolves('0.0.0');
                sb.stub(vscode.window, 'showInformationMessage').resolves(`Download and install v${ToolsConfig.tool['tkn'].version}`);
                const stub = sb.stub(hasha, 'fromFile').onFirstCall().returns(ToolsConfig.tool['tkn'].sha256sum);
                stub.onSecondCall().returns(ToolsConfig.tool['tkn'].sha256sum);
                sb.stub(Archive, 'unzip').resolves();
                await ToolsConfig.detectOrDownload();
                assert.ok(!chmodSyncStub.called);
            });
        });

        suite('on *nix', () => {
            setup(() => {
                sb.stub(Platform, 'getOS').returns('linux');
                sb.stub(Platform, 'getEnv').returns({
                    HOME: 'home'
                });
                ToolsConfig.resetConfiguration();
            });
            test('set executable attribute for tool file', async () => {
                sb.stub(shelljs, 'which');
                sb.stub(fs, 'existsSync').returns(false);
                sb.stub(fsex, 'ensureDirSync').returns();
                sb.stub(ToolsConfig, 'getVersion').resolves('0.0.0');
                sb.stub(vscode.window, 'showInformationMessage').resolves(`Download and install v${ToolsConfig.tool['tkn'].version}`);
                sb.stub(hasha, 'fromFile').onFirstCall().returns(ToolsConfig.tool['tkn'].sha256sum);
                sb.stub(Archive, 'unzip').resolves();
                await ToolsConfig.detectOrDownload();
                assert.ok(chmodSyncStub.called);
            });
        });
    });
    suite('loadMetadata()', () => {
        test('keeps tool configuration if there is no platform attribute', () => {
            let config: object = {
                tkn: {
                    name: 'Tekton Pipeline Tkn tool',
                    version: '0.0.100'
                }
            };
            config = ToolsConfig.loadMetadata(config, 'platform-name');
            assert.ok(config['tkn']);
        });
        test('removes tool configuration if platform is not supported', () => {
            let config: object = {
                tkn: {
                    name: 'Tekton Pipelines Tkn tool',
                    version: '0.0.100',
                    platform: {
                        win32: {
                        }
                    }
                }
            };
            config = ToolsConfig.loadMetadata(config, 'platform-name');
            assert.ok(!config['tkn']);
        });
    });
});