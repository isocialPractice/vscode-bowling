import * as vscode from 'vscode';
import * as path from 'path';

let panel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('bowling.play', () => {
        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
            return;
        }

        panel = vscode.window.createWebviewPanel(
            'bowlingGame',
            'Bowling',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'media'))
                ],
                retainContextWhenHidden: true
            }
        );

        const gameJsUri = panel.webview.asWebviewUri(
            vscode.Uri.file(path.join(context.extensionPath, 'media', 'game.js'))
        );
        const gameCssUri = panel.webview.asWebviewUri(
            vscode.Uri.file(path.join(context.extensionPath, 'media', 'game.css'))
        );

        panel.webview.html = getWebviewContent(panel.webview, gameJsUri, gameCssUri);

        panel.onDidDispose(() => {
            panel = undefined;
        }, null, context.subscriptions);
    });

    context.subscriptions.push(disposable);
}

function getWebviewContent(
    webview: vscode.Webview,
    gameJsUri: vscode.Uri,
    gameCssUri: vscode.Uri
): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
    <link rel="stylesheet" href="${gameCssUri}">
    <title>Bowling</title>
</head>
<body>
    <canvas id="gameCanvas"></canvas>
    <script nonce="${nonce}" src="${gameJsUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function deactivate() {}
