const vscode = require('vscode');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

let transferredFiles = [];
let errorFiles = [];
let sessionStartTime = new Date();
let sessionNumber = 0;
const outputChannel = vscode.window.createOutputChannel('File Transfer Log');

function activate(context) {
    outputChannel.appendLine('Activating extension...');
    let uploadCommand = vscode.commands.registerCommand('scponator.upload', function (uri) {
        startNewSession();
        handleFileTransfer('upload', uri, endSession);
    });
u
    let downloadCommand = vscode.commands.registerCommand('scponator.download', function (uri) {
        startNewSession();
        handleFileTransfer('download', uri, endSession);
    });

    let syncCommand = vscode.commands.registerCommand('scponator.sync', function (uri) {
        startNewSession();
        handleFileTransfer('sync', uri, endSession);
    });

    let uploadProjectCommand = vscode.commands.registerCommand('scponator.uploadProject', function () {
        vscode.window.showInformationMessage('Do you want to upload the entire project?', 'Yes', 'No').then(answer => {
            if (answer === 'Yes') {
                startNewSession();
                handleProjectTransfer('upload', endSession);
            }
        });
    });

    let downloadProjectCommand = vscode.commands.registerCommand('scponator.downloadProject', function () {
        vscode.window.showInformationMessage('Do you want to download the entire project?', 'Yes', 'No').then(answer => {
            if (answer === 'Yes') {
                startNewSession();
                handleProjectTransfer('download', endSession);
            }
        });
    });

    let syncProjectCommand = vscode.commands.registerCommand('scponator.syncProject', function () {
        vscode.window.showInformationMessage('Do you want to sync the entire project?', 'Yes', 'No').then(answer => {
            if (answer === 'Yes') {
                startNewSession();
                handleProjectTransfer('sync', endSession);
            }
        });
    });

    context.subscriptions.push(uploadCommand);
    context.subscriptions.push(downloadCommand);
    context.subscriptions.push(syncCommand);
    context.subscriptions.push(uploadProjectCommand);
    context.subscriptions.push(downloadProjectCommand);
    context.subscriptions.push(syncProjectCommand);

    outputChannel.appendLine('Extension activated successfully.');
}

function startNewSession() {
    sessionStartTime = new Date();
    sessionNumber += 1;
    transferredFiles = [];
    errorFiles = [];
    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine(`Transfer Session ${sessionNumber} started at: ${sessionStartTime.toLocaleString()}`);
}let pendingTransfers = 0;

function endSession() {
    outputChannel.appendLine(`Transfer Session ${sessionNumber} ended at: ${new Date().toLocaleString()}`);
    if (errorFiles.length > 0) {
        outputChannel.appendLine(`Files with errors:`);
        errorFiles.forEach(file => {
            outputChannel.appendLine(`- ${file.path}: ${file.error}`);
            outputChannel.appendLine(`Command used: ${file.command}`);
        });
    }
}

function handleFileTransfer(action, uri, callback) {
    outputChannel.appendLine(`Handling file transfer for action: ${action}`);
    if (!uri) {
        vscode.window.showInformationMessage('No file selected!');
        callback();
        return;
    }

    try {
        const config = getConfig(uri);
        const localPath = uri.fsPath;
        const remotePath = getRemotePath(config, uri);
        const userHost = `${config.username}@${config.host}`;

        if (action === 'upload') {
            uploadFile(config, localPath, remotePath, userHost);
        } else if (action === 'download') {
            downloadFile(config, localPath, remotePath, userHost);
        } else if (action === 'sync') {
            syncFile(config, localPath, remotePath, userHost);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Configuration error: ${error.message}`);
        outputChannel.appendLine(`Configuration error: ${error.message}`);
        callback();
    }
}

async function handleProjectTransfer(action) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace is open!');
        return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    try {
        const config = getConfig(null);  // Pass null to get config from workspace root
        const remotePath = config.remoteDirectory;
        const userHost = `${config.username}@${config.host}`;
        const ignorePatterns = config.ignore || [];

        outputChannel.appendLine(`Starting project ${action}...`);

        await traverseDirectory(workspaceRoot, async (localPath) => {
            const relativePath = path.relative(workspaceRoot, localPath);
            const remoteFilePath = path.join(remotePath, relativePath).replace(/\\/g, '/');

            if (action === 'upload') {
                await uploadFile(config, localPath, remoteFilePath, userHost);
            } else if (action === 'download') {
                await downloadFile(config, localPath, remoteFilePath, userHost);
            } else if (action === 'sync') {
                await syncFile(config, localPath, remoteFilePath, userHost);
            }
        }, ignorePatterns);

        endSession();
    } catch (error) {
        vscode.window.showErrorMessage(`Configuration error: ${error.message}`);
        outputChannel.appendLine(`Configuration error: ${error.message}`);
    }
}

async function traverseDirectory(dir, callback, ignorePatterns) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        // Skip '.' and '..'
        if (file === '.' || file === '..') {
            continue;
        }

        const fullPath = path.join(dir, file);
        const relativePath = path.relative(dir, fullPath);

        if (shouldIgnore(relativePath, ignorePatterns)) {
            continue;
        }

        if (fs.lstatSync(fullPath).isDirectory()) {
            await traverseDirectory(fullPath, callback, ignorePatterns);
        } else {
            await callback(fullPath);
        }
    }
}



function shouldIgnore(filePath, patterns) {
    return patterns.some(pattern => {
        const regex = new RegExp(pattern.replace('*', '.*').replace('?', '.'));
        return regex.test(filePath);
    });
}

function getConfig(uri) {
    let configPath = uri ? path.join(path.dirname(uri.fsPath), '.scpconfig.json') : '';

    if (!fs.existsSync(configPath)) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            configPath = path.join(workspaceFolders[0].uri.fsPath, '.scpconfig.json');
        }

        if (!fs.existsSync(configPath)) {
            throw new Error('Configuration file .scpconfig.json not found in the selected directory or workspace root!');
        }
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const requiredFields = ['username', 'host', 'remoteDirectory'];
    for (const field of requiredFields) {
        if (!config[field]) {
            throw new Error(`Configuration file .scpconfig.json is missing the required field: ${field}`);
        }
    }

    return config;
}

function getRemotePath(config, uri) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        throw new Error('No workspace is open!');
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const relativePath = path.relative(workspaceRoot, uri.fsPath);
    return path.join(config.remoteDirectory, relativePath).replace(/\\/g, '/');
}

function buildMkdirCommand(config, remoteDir) {
    let authOptions = '';
    if (config.privateKey) {
        authOptions =` -i ${config.privateKey}`;
    } else if (config.password) {
        authOptions = `sshpass -p ${config.password}`;
    }
    return `${authOptions} ssh ${config.username}@${config.host} "mkdir -p ${remoteDir}"`;
}

function buildScpCommand(config, source, userHost, destination, action) {
    let authOptions = '';
    if (config.privateKey) {
        authOptions = `-i ${config.privateKey}`;
    } else if (config.password) {
        authOptions = `sshpass -p ${config.password}`;
    }
    if (action === 'upload') {
        return `${authOptions} scp -r ${source} ${userHost}:${destination}`;
    } else if (action === 'download') {
        return `${authOptions} scp -r ${userHost}:${source} ${destination}`;
    }
}

async function uploadFile(config, localPath, remotePath, userHost,  retryCount = 3, delay = 2000) {
    const baseDir = config.remoteDirectory;
    const remoteDir = path.dirname(remotePath);

    if (remoteDir !== baseDir) {
        createRemoteDirectory(config, remoteDir, (mkdirError) => {
            if (mkdirError) {
                outputChannel.appendLine(`Error during directory creation, aborting upload for ${localPath}`);
            } else {
                uploadFileWithRetry(config, localPath, remotePath, userHost, retryCount, delay);
            }
        }, retryCount, delay);
    } else {
        uploadFileWithRetry(config, localPath, remotePath, userHost, retryCount, delay);
    }
}


function uploadFileWithRetry(config, localPath, remotePath, userHost, retryCount = 3, delay = 2000) {
    const scpCommand = buildScpCommand(config, localPath, userHost, remotePath, 'upload');

    const executeScpCommand = (retriesLeft) => {
        exec(scpCommand, (err, stdout, stderr) => {
            if (err) {
                if (retriesLeft > 0) {
                    setTimeout(() => executeScpCommand(retriesLeft - 1), delay);
                } else {
                    outputChannel.appendLine(`Final upload error for file ${localPath}: ${stderr}`);
                    outputChannel.appendLine(`Command used: ${scpCommand}`);
                    outputChannel.appendLine(`Source: ${localPath}`);
                    outputChannel.appendLine(`Destination: ${remotePath}`);
                    vscode.window.showErrorMessage(`Error uploading file ${localPath}: ${stderr}`);
                    errorFiles.push({ path: localPath, error: stderr, command: scpCommand });
                }
            } else {
                const fileSize = fs.statSync(localPath).size;
                transferredFiles.push({ direction: 'Sent', path: localPath, size: fileSize, timestamp: new Date() });
                outputChannel.appendLine(`${localPath} --> ${remotePath}`);
            }
        });
    };

    executeScpCommand(retryCount);
}



function createRemoteDirectory(config, remoteDir, callback, retryCount = 3, delay = 2000) {
    const mkdirCommand = buildMkdirCommand(config, remoteDir);

    const executeMkdirCommand = (retriesLeft) => {
        exec(mkdirCommand, (err, stdout, stderr) => {
            if (err) {
                if (retriesLeft > 0) {
                    setTimeout(() => executeMkdirCommand(retriesLeft - 1), delay);
                } else {
                    outputChannel.appendLine(`Final error creating remote directory ${remoteDir}: ${stderr}`);
                    outputChannel.appendLine(`Command used: ${mkdirCommand}`);
                    errorFiles.push({ path: remoteDir, error: stderr, command: mkdirCommand });
                    if (callback) callback(err);
                }
            } else {
                callback(null);
            }
        });
    };

    executeMkdirCommand(retryCount);
}



function downloadFile(config, localPath, remotePath, userHost, callback=null, retryCount = 3) {
    const scpCommand = buildScpCommand(config, remotePath, userHost, localPath, 'download');

    const executeCommand = (retriesLeft) => {
        exec(scpCommand, (err, stdout, stderr) => {
            if (err) {
                outputChannel.appendLine(`Download error for file ${remotePath}: ${stderr}`);
                outputChannel.appendLine(`Command used: ${scpCommand}`);
                outputChannel.appendLine(`Source: ${remotePath}`);
                outputChannel.appendLine(`Destination: ${localPath}`);
                if (retriesLeft > 0) {
                    executeCommand(retriesLeft - 1);
                } else {
                    vscode.window.showErrorMessage(`Error downloading file ${remotePath}: ${stderr}`);
                    errorFiles.push({ path: remotePath, error: stderr, command: scpCommand });
                    if (callback) callback();
                    return;
                }
            } else {
                const fileSize = fs.existsSync(localPath) ? fs.statSync(localPath).size : 0;
                transferredFiles.push({ direction: 'Received', path: localPath, size: fileSize, timestamp: new Date() });
                outputChannel.appendLine(`${localPath} <--  ${remotePath}`);
                if (callback) callback();
            }
        });
    };

    executeCommand(retryCount);
}

function syncFile(config, localPath, remotePath, userHost, callback=null) {
    let localMTime = 0;
    if (fs.existsSync(localPath)) {
        const localStat = fs.statSync(localPath);
        localMTime = new Date(localStat.mtime).getTime();
    }

    const remoteCommand = `ssh ${userHost} "stat -c %Y ${remotePath}"`;
    exec(remoteCommand, (err, stdout, stderr) => {
        if (err) {
            if (stderr.includes('No such file or directory')) {
                uploadFile(config, localPath, remotePath, userHost, () => {
                    updateLocalMTime(localPath, remotePath, userHost, () => {
                        outputChannel.appendLine(`File synchronized (uploaded): ${localPath}`);
                        outputChannel.appendLine(`Source: ${localPath}`);
                        outputChannel.appendLine(`Destination: ${remotePath}`);
                        if (callback) callback();
                    });
                });
            } else {
                vscode.window.showErrorMessage(`Error: ${stderr}`);
                outputChannel.appendLine(`Remote stat error: ${stderr}`);
                if (callback) callback();
            }
            return;
        }

        const remoteMTime = parseInt(stdout.trim()) * 1000;
        if (localMTime > remoteMTime) {
            uploadFile(config, localPath, remotePath, userHost, () => {
                updateLocalMTime(localPath, remotePath, userHost, () => {
                    outputChannel.appendLine(`${localPath} --> ${remotePath}`);
                    if (callback) callback();
                });
            });
        } else if (remoteMTime > localMTime) {
            downloadFile(config, localPath, remotePath, userHost, () => {
                updateLocalMTime(localPath, remotePath, userHost, () => {
                    outputChannel.appendLine(`${remotePath} <-- ${localPath}`);
                    if (callback) callback();
                });
            });
        } else {
            vscode.window.showInformationMessage(`Files are already synchronized: ${localPath}`);
            outputChannel.appendLine(`Files are already synchronized: ${localPath}`);
            if (callback) callback();
        }
    });
}

function updateLocalMTime(localPath, remotePath, userHost, callback) {
    const remoteCommand = `ssh ${userHost} "stat -c %Y ${remotePath}"`;
    exec(remoteCommand, (err, stdout, stderr) => {
        if (err) {
            vscode.window.showErrorMessage(`Error: ${stderr}`);
            outputChannel.appendLine(`Remote stat error: ${stderr}`);
            return;
        }

        const remoteMTime = parseInt(stdout.trim()) * 1000;
        fs.utimesSync(localPath, new Date(), new Date(remoteMTime));
        if (callback) callback();
    });
}

exports.activate = activate;

function deactivate() { }

module.exports = {
    activate,
    deactivate
};