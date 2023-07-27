import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

class FileOperationHandler {
  constructor(private dryRun: boolean) {}

  async moveFile(filePath: string, moveTo: string) {
    if (this.dryRun) {
      return;
    }

    if (!fsSync.existsSync(path.dirname(moveTo))) {
      await fs.mkdir(path.dirname(moveTo), {recursive: true});
    }

    await fs.rename(filePath, moveTo);
  }

  async copyFile(filePath: string, copyTo: string) {
    if (this.dryRun) {
      return;
    }

    if (!fsSync.existsSync(path.dirname(copyTo))) {
      await fs.mkdir(path.dirname(copyTo), {recursive: true});
    }

    await fs.copyFile(filePath, copyTo);
  }

  async linkFile(filePath: string, linkTo: string) {
    if (this.dryRun) {
      return;
    }

    if (!fsSync.existsSync(path.dirname(linkTo))) {
      await fs.mkdir(path.dirname(linkTo), {recursive: true});
    }

    await fs.link(filePath, linkTo);
  }

  async deleteFile(filePath: string) {
    if (this.dryRun) {
      return;
    }

    await fs.rm(filePath);
  }
}

export default FileOperationHandler;
