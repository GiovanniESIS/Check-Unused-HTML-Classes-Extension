import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('extension.checkUnusedClasses', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Open an HTML file first!');
            return;
        }

        const fileExtension = editor.document.fileName.split('.').pop()?.toLowerCase();
        if (fileExtension !== 'html') {
            vscode.window.showErrorMessage(
                `Cannot run the extension on a .${fileExtension} file, make sure to run this extension on an HTML file.`
            );
            return;
        }

        const htmlText = editor.document.getText();

        // Classi
        const classRegex = /class\s*=\s*"([^"]+)"/g;
        let match;
        const htmlClasses = new Set<string>();
        while ((match = classRegex.exec(htmlText)) !== null) {
            const classes = match[1].split(/\s+/);
            classes.forEach(c => htmlClasses.add(c));
        }

        // ID
        const idRegex = /id\s*=\s*"([^"]+)"/g;
        let idMatch;
        const htmlIds = new Set<string>();
        while ((idMatch = idRegex.exec(htmlText)) !== null) {
            htmlIds.add(idMatch[1].trim());
        }

        const cssFiles = await vscode.workspace.findFiles('**/*.css');
        const cssMap: { [key: string]: string } = {};
        for (const file of cssFiles) {
            const doc = await vscode.workspace.openTextDocument(file);
            cssMap[file.fsPath] = doc.getText().replace(/\/\*[\s\S]*?\*\//g, '');
        }

        const externalCssLinks: string[] = [];
        const linkRegex = /<link[^>]*href=["']([^"']+)["'][^>]*>/g;
        let linkMatch;
        while ((linkMatch = linkRegex.exec(htmlText)) !== null) {
            const href = linkMatch[1];
            if (href.startsWith('http')) {
                externalCssLinks.push(href);
            }
        }

        const output = vscode.window.createOutputChannel("HTML Class Checker");
        output.clear();
        output.show(true);

        const workspaceFolder = vscode.workspace.workspaceFolders
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : '';

        // Nessuna classe e nessun ID
        if (htmlClasses.size === 0 && htmlIds.size === 0) {
            output.appendLine("  There are no classes or IDs in this HTML file yet.");
            vscode.window.showInformationMessage('Class check complete! See the "HTML Class Checker" panel.');
            return;
        }

        const localClassGroups: { [filePath: string]: { used: string[], unused: string[] } } = {};
        const externalClassGroups: { [link: string]: { used: string[], unused: string[] } } = {};
        const notFoundClasses: string[] = [];

        const localIdGroups: { [filePath: string]: string[] } = {};
        const notFoundIds: string[] = [];

        // Controlla classi
        htmlClasses.forEach(cls => {
            let foundLocal = false;
            let localFile = '';

            for (const filePath in cssMap) {
                const content = cssMap[filePath];
                const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`\\.${escaped}\\b`);
                if (regex.test(content)) {
                    foundLocal = true;
                    localFile = filePath;
                    break;
                }
            }

            if (foundLocal) {
                if (!localClassGroups[localFile]) localClassGroups[localFile] = { used: [], unused: [] };
                localClassGroups[localFile].used.push(cls);
            } else {
                const isFontAwesome = /^(fa|fas|far|fal|fab|fad|fa-.+)$/.test(cls);
                if (isFontAwesome && externalCssLinks.length > 0) {
                    const key = externalCssLinks.join(', ');
                    if (!externalClassGroups[key]) externalClassGroups[key] = { used: [], unused: [] };
                    externalClassGroups[key].used.push(cls);
                } else {
                    notFoundClasses.push(cls);
                }
            }
        });

        // Controlla ID
        htmlIds.forEach(id => {
            let foundLocal = false;
            let localFile = '';

            for (const filePath in cssMap) {
                const content = cssMap[filePath];
                const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`#${escaped}\\b`);
                if (regex.test(content)) {
                    foundLocal = true;
                    localFile = filePath;
                    break;
                }
            }

            if (foundLocal) {
                if (!localIdGroups[localFile]) localIdGroups[localFile] = [];
                localIdGroups[localFile].push(id);
            } else {
                notFoundIds.push(id);
            }
        });

        // Stampa classi solo se ce ne sono
        if (htmlClasses.size > 0) {
            output.appendLine("===== HTML CLASS CHECK =====");
            output.appendLine("");

            for (const filePath in localClassGroups) {
                const { used } = localClassGroups[filePath];

                let relativePath = workspaceFolder
                    ? path.relative(workspaceFolder, filePath)
                    : filePath;

                const workspaceName = workspaceFolder ? path.basename(workspaceFolder) : '';
                const folderOnly = (workspaceName + '/' + path.dirname(relativePath))
                    .replace(/\\/g, '/')
                    .replace(/\/$/, '')
                    .replace(/\/\.$/, '');

                output.appendLine(`  File:   ${path.basename(filePath)}`);
                output.appendLine(`  Folder: ${folderOnly}`);
                output.appendLine("");
                used.forEach(cls => output.appendLine(`    - ${cls}`));
                output.appendLine("");
            }

            for (const link in externalClassGroups) {
                const { used } = externalClassGroups[link];
                output.appendLine(`  Source: ${link}`);
                output.appendLine("");
                used.forEach(cls => output.appendLine(`    - ${cls}`));
                output.appendLine("");
            }

            if (notFoundClasses.length > 0) {
                output.appendLine("  ⚠ Classes not found in local CSS or external links:");
                output.appendLine("");
                notFoundClasses.forEach(cls => output.appendLine(`    - ${cls}  (unused)`));
                output.appendLine("");
            }

            output.appendLine("===== END CLASS CHECK =====");
            output.appendLine("");
        }

        // Stampa ID solo se ce ne sono
        if (htmlIds.size > 0) {
            output.appendLine("===== HTML ID CHECK =====");
            output.appendLine("");

            for (const filePath in localIdGroups) {
                const ids = localIdGroups[filePath];

                let relativePath = workspaceFolder
                    ? path.relative(workspaceFolder, filePath)
                    : filePath;

                const workspaceName = workspaceFolder ? path.basename(workspaceFolder) : '';
                const folderOnly = (workspaceName + '/' + path.dirname(relativePath))
                    .replace(/\\/g, '/')
                    .replace(/\/$/, '')
                    .replace(/\/\.$/, '');

                output.appendLine(`  File:   ${path.basename(filePath)}`);
                output.appendLine(`  Folder: ${folderOnly}`);
                output.appendLine("");
                ids.forEach(id => output.appendLine(`    - #${id}`));
                output.appendLine("");
            }

            if (notFoundIds.length > 0) {
                output.appendLine("  ⚠ IDs not found in local CSS:");
                output.appendLine("");
                notFoundIds.forEach(id => output.appendLine(`    - #${id}  (unused)`));
                output.appendLine("");
            }

            output.appendLine("===== END ID CHECK =====");
        }

        vscode.window.showInformationMessage('Class check complete! See the "HTML Class Checker" panel.');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() { }