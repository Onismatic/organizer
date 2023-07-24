import fs from "fs/promises";
import path from "path";
import { ExifTool } from "exiftool-vendored";
import fecha from "fecha";
import fsSync from "fs";
import md5File from "md5-file";
import ora, {Ora} from 'ora';

import * as readlinePromises from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
const readline = readlinePromises.createInterface({input, output});

import { OrganizerOptions } from "./app";

type DuplicationHashDictionary = {
  [checkSum: string]: string[]
}

type OperationsCheckSumsDone = string[];

type FileOperation = {
  folderPath: string;
  path: string;
  newPath: string | null;
  action: Actions | null;
  creationDate: string;
  checkSum: string;
  error?: string;
}

enum Actions {
  MOVED = "MOVED",
  COPIED = "COPIED",
  LINKED = "LINKED",
  SKIPPED = "SKIPPED",
  DELETED = "DELETED",
  DELETED_DUPLICATE = "DELETED_DUPLICATE",
  DELETED_EXISTING = "DELETED_EXISTING",
  ERROR = "ERROR",
}

class FileOrganizer {
  inputFolder: string;
  outputFolder: string;
  options: OrganizerOptions;

  exiftool: ExifTool;

  filesList: FileOperation[] = [];
  duplicationHashDictionary: DuplicationHashDictionary = {};
  operationsCheckSumsDone: OperationsCheckSumsDone = [];
  destinationFilesCheckSum: string[] = [];

  filesFound = 0;
  duplicateFilesFound = 0;
  foldersFound = 0;
  uniqueFiles = 0;

  operationsDone = 0;
  operationsErrorCount = 0;
  filesSkippedAlreadyExist = 0;

  constructor(inputFolder: string, outputFolder: string, options: OrganizerOptions) {
    this.inputFolder = inputFolder;
    this.outputFolder = outputFolder;
    this.options = options;
    this.exiftool = new ExifTool({taskTimeoutMillis: 5000});
  }

  async organize() {
    const buildingSpinner = ora(this._buildSpinnerText()).start();
    this.filesList = await this.buildFilesTree(this.inputFolder, buildingSpinner);
    this.uniqueFiles = Object.keys(this.duplicationHashDictionary).length;

    buildingSpinner.stopAndPersist({symbol: "✔️", text: this._buildSpinnerText(true)});

    if (fsSync.existsSync(path.resolve(this.outputFolder))) {
      const destinationFilesSpinner = ora(`Getting destination files check sums...`).start();
      await this.getDestinationFilesCheckSums(this.outputFolder, destinationFilesSpinner);
      destinationFilesSpinner.stopAndPersist({symbol: "✔️", text: `Destination files check sums done. ${this.destinationFilesCheckSum.length} files found.\n`});
    }

    const operationsSpinner = ora(this._buildOperationsSpinnerText(`Initializing...`)).start();
    this.filesList = await this.execOperations(this.filesList, operationsSpinner);
    operationsSpinner.stopAndPersist({symbol: "✔️", text: this._buildOperationsSpinnerText(`Done.`)});

    if (this.options.save) {
      const date = fecha.format(new Date(), "DD-MM-YYYY_HH-mm-ss");
      await fs.writeFile(this.inputFolder + `organizer-tree-${date}.json`, JSON.stringify(this.filesList, null, 2));
      await fs.writeFile(this.inputFolder + `organizer-duplication-hash-dictionary-${date}.json`, JSON.stringify(this.duplicationHashDictionary, null, 2));
      await fs.writeFile(this.inputFolder + `organizer-hashed-dictionary-file-action-${date}.json`, JSON.stringify(this.operationsCheckSumsDone, null, 2));
    }
  }

  _buildSpinnerText(done = false) {
    const info = `Files: ${this.filesFound}\nDuplicate files: ${this.duplicateFilesFound}\nFolders: ${this.foldersFound}`;

    if (done) {
      return `File structure built.\n\n${info}\n`;
    }

    return `Building file structure...\n\n${info}`;
  }

  async buildFilesTree(folder: string, spinner?: Ora): Promise<FileOperation[]> {
    const folderPath = path.resolve(folder);

    let files = await fs.readdir(folderPath, {withFileTypes: true});
    const activeFileList: FileOperation[] = [];

    for (const file of files) {
      let pathRes = path.normalize(path.join(folderPath, file.name));

      if (file.isFile()) {
        this.filesFound++;

        if (spinner) {
          spinner.text = this._buildSpinnerText();
          spinner.render();
        }

        const [checkSum, creationDate] = await Promise.all([
          md5File(pathRes),
          this.getCreationDate(pathRes),
        ])

        if (!this.duplicationHashDictionary[checkSum]) {
          this.duplicationHashDictionary[checkSum] = [];
        } else {
          this.duplicateFilesFound++;

          if (spinner) {
            spinner.text = this._buildSpinnerText();
            spinner.render();
          }
        }

        this.duplicationHashDictionary[checkSum].push(pathRes);

        activeFileList.push({
          folderPath: folderPath,
          path: pathRes,
          action: null,
          newPath: null,
          creationDate,
          checkSum,
        });
      } else if (file.isDirectory()) {
        this.foldersFound++;

        if (spinner) {
          spinner.text = this._buildSpinnerText();
          spinner.render();
        }

        const filesInFolder = await this.buildFilesTree(pathRes, spinner);
        activeFileList.push(...filesInFolder);
      }
    }

    return activeFileList;
  }

  async getDestinationFilesCheckSums(folder: string, spinner?: Ora) {
    const folderPath = path.resolve(folder);

    let files = await fs.readdir(folderPath, {withFileTypes: true});

    for (const file of files) {
      let pathRes = path.normalize(path.join(folderPath, file.name));

      if (file.isFile()) {
        const checkSum = await md5File(pathRes);
        this.destinationFilesCheckSum.push(checkSum);

        if (spinner) {
          spinner.text = `Getting destination files check sums... ${this.destinationFilesCheckSum.length}`;
          spinner.render();
        }
      } else if (file.isDirectory()) {
        await this.getDestinationFilesCheckSums(pathRes, spinner);
      }
    }
  }

  async getExifDate(filePath: string) {
    const tags = await this.exiftool.read(filePath, ["CreateDate"]);
    const exifCreationDate = tags.CreateDate;
    return typeof exifCreationDate == "string" ? exifCreationDate : exifCreationDate?.toISOString() || null;
  }

  async getFileCreationDate(filePath: string) {
    const fileStats = await fs.stat(filePath);
    return fileStats.birthtime.toISOString();
  }

  async getCreationDate(filePath: string) {
    if (this.options.useCreationDate) {
      return await this.getFileCreationDate(filePath);
    }

    const exifCreationDate = await this.getExifDate(filePath);
    return exifCreationDate || await this.getFileCreationDate(filePath);
  }

  async execOperations(filesOperations: FileOperation[], spinner?: Ora) {
    for (let index = 0; index < filesOperations.length; index++) {
      const operation = filesOperations[index];

      const operationDone = this.operationsCheckSumsDone.includes(operation.checkSum);
      if (operationDone) {
        if (this.options.deleteDuplicates && this.options.move) {
          filesOperations[index] = await this.tryDeleteFile(operation, spinner);
          filesOperations[index].action = Actions.DELETED_DUPLICATE;
          continue;
        }

        filesOperations[index].action = Actions.SKIPPED;
        continue;
      }

      const fileExist = this.destinationFilesCheckSum.includes(operation.checkSum);
      if (fileExist) {
        if (this.options.deleteExist && this.options.move) {
          filesOperations[index] = await this.tryDeleteFile(operation, spinner);
          filesOperations[index].action = Actions.DELETED_EXISTING;
          continue;
        }

        filesOperations[index].action = Actions.SKIPPED;
        continue;
      }

      const filePath = filesOperations[index].path;
      const folderPath = filesOperations[index].folderPath;
      const newPath = await this.getNewPath(filePath, folderPath, filesOperations[index].creationDate);

      if (newPath == null) {
        filesOperations[index].action = Actions.SKIPPED;
        continue;
      }

      filesOperations[index].newPath = newPath;

      if (this.options.move) {
        filesOperations[index] = await this.tryMoveFile(operation, index, spinner);
        continue;
      }

      if (this.options.link) {
        filesOperations[index] = await this.tryLinkFile(operation, index, spinner);
        continue;
      }

      filesOperations[index] = await this.tryCopyFile(operation, index, spinner);

      this.operationsCheckSumsDone.push(operation.checkSum);

      // Await a few milliseconds to avoid problems with the file system
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return filesOperations;
  }

  async getNewPath(fileSrcPath: string, folderPath: string, creationDate: string) {
    try {
      let formatCreationDate = fecha.format(new Date(creationDate), this.options.dateFormat)
      formatCreationDate = formatCreationDate
        .replace(/:/g, "-")
        .replace(/ /g, "-");

      let moveToFolder = path.normalize(path.join(path.resolve(this.outputFolder), formatCreationDate));
      const fileName = path.basename(fileSrcPath);
      const newPath = path.normalize(path.join(moveToFolder, fileName));

      return await this.checkExist(newPath, fileSrcPath, moveToFolder);
    } catch (error: any) {
      console.error(`An error occurred while getting creation date for file ${fileSrcPath}\n\nError: `, error);
      return null;
    }
  }

  async checkExist(newPath: string, srcPath: string, moveToFolder: string) {
    if (!fsSync.existsSync(newPath)) {
      // The file doesn't exist, so we can move it
      return newPath;
    }

    const fileName = path.basename(srcPath);

    // The file already exist, so we check if the file is the same
    const srcFileCheckSum = await md5File(srcPath);
    const destFileCheckSum = await md5File(newPath);

    if (destFileCheckSum == srcFileCheckSum) {
      // The file is the same, so we can skip it
      this.filesSkippedAlreadyExist++;
      return null;
    }

    if (this.options.interactive && !this.options.dryRun) {
      // Ask the user what to do
      let answer = null;
      do {
        answer = await readline.question(`File ${fileName} already exist in ${moveToFolder}, what do you want to do?\n1. Skip file\n2. Rename file\n3. Replace file`);
      } while (answer != "1" && answer != "2" && answer != "3");

      switch (answer) {
        case "1":
          return null;
        case "2":
          let newFileName = null;
          do {
            newFileName = await readline.question(`New file name for ${fileName}: `);
          } while (newFileName == "" || fsSync.existsSync(path.join(moveToFolder, newFileName)));

          return path.join(moveToFolder, newFileName);
        case "3":
          return newPath;
        default:
          return null;
      }
    }

    const fileExtension = path.extname(fileName);
    const fileNameWithoutExtension = path.basename(fileName, fileExtension);

    let i = 1;
    let newOutPath = null;
    do {
      i++;
      newOutPath = path.join(moveToFolder, `${fileNameWithoutExtension}-${i}${fileExtension}`);
    } while (fsSync.existsSync(newOutPath));

    return newOutPath;
  }

  _buildOperationsSpinnerText(body: string) {
    const totalOfOperations = (this.options.deleteDuplicates && this.options.move) ? this.filesFound : this.uniqueFiles;
    const operations = `Operations done: ${this.operationsDone + this.filesSkippedAlreadyExist} of ${totalOfOperations}`;
    const percent = `(${(((this.operationsDone + this.filesSkippedAlreadyExist) / totalOfOperations) * 100).toFixed(2)}%)`;

    const operationsPercent = `${operations} ${percent}`;
    const errors = `Errors: ${this.operationsErrorCount}`;
    const skipped = `Skipped files: ${this.filesSkippedAlreadyExist}`;
    const action = this.options.move ? "Moving" : this.options.link ? "Linking" : "Copying";
    const title = `${action} files in progress...`;

    return `${title}\n\n${body}\n\n${operationsPercent}\n${errors}\n${skipped}`;
  }

  async tryCopyFile(fileOperation: FileOperation, index: number, spinner?: Ora) {
    try {
      if (spinner) {
        spinner.text = this._buildOperationsSpinnerText(`Copying file ${fileOperation.path} to ${fileOperation.newPath!}$`);
        spinner.render();
      }

      await this.copyFile(fileOperation.path, fileOperation.newPath!);
      fileOperation.action = Actions.COPIED;

      this.operationsDone++;
    } catch (error: any) {
      fileOperation.action = Actions.ERROR;
      fileOperation.error = error.message;

      this.operationsErrorCount++;
    }

    return fileOperation
  }

  async copyFile(filePath: string, copyTo: string) {
    if (this.options.dryRun) {
      return;
    }

    if (!fsSync.existsSync(path.dirname(copyTo))) {
      await fs.mkdir(path.dirname(copyTo), {recursive: true});
    }

    await fs.copyFile(filePath, copyTo);
  }

  async tryLinkFile(fileOperation: FileOperation, index: number, spinner?: Ora) {
    try {
      if (spinner) {
        spinner.text = this._buildOperationsSpinnerText(`Linking file ${fileOperation.path} to ${fileOperation.newPath!}`);
        spinner.render();
      }

      await this.linkFile(fileOperation.path, fileOperation.newPath!);
      fileOperation.action = Actions.LINKED;

      this.operationsDone++;
    } catch (error: any) {
      fileOperation.action = Actions.ERROR;
      fileOperation.error = error.message;

      this.operationsErrorCount++;
    }

    return fileOperation;
  }

  async linkFile(filePath: string, linkTo: string) {
    if (this.options.dryRun) {
      return;
    }

    if (!fsSync.existsSync(path.dirname(linkTo))) {
      await fs.mkdir(path.dirname(linkTo), {recursive: true});
    }

    await fs.link(filePath, linkTo);
  }

  async tryMoveFile(fileOperation: FileOperation, index: number, spinner?: Ora) {
    try {
      if (spinner) {
        spinner.text = this._buildOperationsSpinnerText(`Moving file ${fileOperation.path} to ${fileOperation.newPath!}`);
        spinner.render();
      }

      await this.moveFile(fileOperation.path, fileOperation.newPath!);
      fileOperation.action = Actions.MOVED;

      this.operationsDone++;
    } catch (error: any) {
      fileOperation.action = Actions.ERROR;
      fileOperation.error = error.message;

      this.operationsErrorCount++;
    }

    return fileOperation;
  }

  async moveFile(filePath: string, moveTo: string) {
    if (this.options.dryRun) {
      return;
    }

    if (!fsSync.existsSync(path.dirname(moveTo))) {
      await fs.mkdir(path.dirname(moveTo), {recursive: true});
    }

    await fs.rename(filePath, moveTo);
  }

  async tryDeleteFile(fileOperation: FileOperation, spinner?: Ora) {
    try {
      if (spinner) {
        spinner.text = this._buildOperationsSpinnerText(`Deleting file ${fileOperation.path}`);
        spinner.render();
      }

      await this.deleteFile(fileOperation.path);
      fileOperation.action = Actions.DELETED;

      this.operationsDone++;
    } catch (error: any) {
      fileOperation.action = Actions.ERROR;
      fileOperation.error = error.message;

      this.operationsErrorCount++;
    }

    return fileOperation;
  }

  async deleteFile(filePath: string) {
    if (this.options.dryRun) {
      return;
    }

    await fs.rm(filePath);
  }
}

export default FileOrganizer;
