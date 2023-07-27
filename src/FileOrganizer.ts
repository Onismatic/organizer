import fs from "fs/promises";
import path from "path";
import {ExifTool} from "exiftool-vendored";
import fecha from "fecha";
import fsSync, {Dirent} from "fs";
import md5File from "md5-file";
import ora, {Ora} from 'ora';
import pMap from "p-map";
import FileOperationHandler from "./FileOperationHandler";
import NewPathResolver from "./NewPathResolver";
import OperationHandler from "./OperationHandler";

import * as readlinePromises from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import {OrganizerOptions} from "./app";

const readline = readlinePromises.createInterface({input, output});

export enum Actions {
  MOVED = "MOVED",
  COPIED = "COPIED",
  LINKED = "LINKED",
  SKIPPED = "SKIPPED",
  SKIPPED_DUPLICATE = "SKIPPED_DUPLICATE",
  SKIPPED_EXISTING = "SKIPPED_EXISTING",
  DELETED = "DELETED",
  DELETED_DUPLICATE = "DELETED_DUPLICATE",
  DELETED_EXISTING = "DELETED_EXISTING",
  ERROR = "ERROR",
}

class FileOrganizer {
  inputFolder: string;
  outputFolder: string;
  saveOutputFolder: string;
  options: OrganizerOptions;

  exiftool: ExifTool;
  fileOperationHandler: FileOperationHandler;
  newPathResolver: NewPathResolver;
  operationHandler: OperationHandler;

  filesList: FileOperation[] = [];
  destFileList: string[] = [];

  operationsCheckSumsDone: OperationsCheckSumsDone = [];
  srcDuplicationMap: HashedPaths = {};
  destDuplicationMap: HashedPaths = {};

  srcFilesInfo: SrcFileCheckSum = {};
  destFilesInfo: DestFileCheckSum = {};

  srcFilesCount = 0;
  destFilesCount = 0;
  srcDuplicationCount = 0;
  destDuplicationCount = 0;
  uniqueFilesCount = 0;
  foldersCount = 0;


  currentAction = "";

  filesSkippedAlreadyExist = 0;
  destFilesTotal = 0;

  constructor(inputFolder: string, outputFolder: string, options: OrganizerOptions) {
    this.inputFolder = path.resolve(inputFolder);
    this.outputFolder = path.resolve(outputFolder);
    this.options = options;
    this.exiftool = new ExifTool({taskTimeoutMillis: 5000});

    this.fileOperationHandler = new FileOperationHandler(options.dryRun);
    this.newPathResolver = new NewPathResolver(outputFolder, options.dateFormat, options.interactive, options.dryRun);
    this.operationHandler = new OperationHandler(this.fileOperationHandler);

    if (this.options.save && this.options.saveOutput != '') {
      if (!this._validateSaveOutputFolder()) {
        console.error(`The path ${this.options.saveOutput} is not a directory.`);
        process.exit();
      }

      this.saveOutputFolder = path.resolve(this.options.saveOutput);
    } else {
      this.saveOutputFolder = this.outputFolder;
    }
  }

  async loadChecksums() {
    const checksumsSpinner = ora(`Loading checksums...`).start();
    await Promise.all([
      this.loadSourceFilesCheckSum(),
      this.loadDestinationFilesCheckSum(),
    ]);
    checksumsSpinner.stopAndPersist({symbol: "✔️", text: `Checksums loaded.\n`});
  }

  async loadDestinationFilesAndInfo() {
    const destinationFilesSpinner = ora(`Loading destination files...\n\n`).start();
    this.destFileList = await this.loadDestinationFiles(this.outputFolder);
    await this.loadDestinationFilesInfo(async () => {
      destinationFilesSpinner.text = `Loading destination files...\n\n${this.currentAction}`;
    });
    this.destFilesTotal = this.destFileList.length;
    destinationFilesSpinner.stopAndPersist({symbol: "✔️", text: `Destination files loaded. ${this.destFilesTotal} files found.\n`});
  }

  async loadSourceFilesAndInfo() {
    const srcFilesSpinner = ora({
      text: this._spinnerTextLoadingFiles(),
      spinner: 'dots',
    }).start();

    const spinnerUpdater = async () => {
      srcFilesSpinner.text = this._spinnerTextLoadingFiles();
    }

    this.filesList = await this.loadFileList(this.inputFolder, spinnerUpdater);
    await this.loadFilesInfo(this.filesList, spinnerUpdater);

    srcFilesSpinner.stopAndPersist({
      symbol: "✔️",
      text: this._spinnerTextLoadingFiles(),
    });
  }

  async saveSourceChecksums(date: string) {
    console.log(`Saving source files checksums...`)

    if (!fsSync.existsSync(this.saveOutputFolder)) {
      await fs.mkdir(this.saveOutputFolder, {recursive: true});
    }

    await fs.writeFile(path.join(this.saveOutputFolder, `file-list-checksum-${date}.orgz.json`), JSON.stringify(this.srcFilesInfo, null, 2));
  }

  async organizeFilesAndUpdateList() {
    const operationsSpinner = ora(this._buildOperationsSpinnerText(`Initializing...`)).start();
    this.filesList = await this.organizeFiles(this.filesList, operationsSpinner);
    operationsSpinner.stopAndPersist({symbol: "✔️", text: this._buildOperationsSpinnerText(`Done.`)});
  }

  async organize() {
    const date = fecha.format(new Date(), "YY-MM-DD_HH-mm-ss");

    if (this.options.destinationChecksums != '' || this.options.sourceChecksums != '') {
      await this.loadChecksums();
    }

    if (fsSync.existsSync(path.resolve(this.outputFolder))) {
      await this.loadDestinationFilesAndInfo();

      if (this.options.save) {
        console.log(`Saving destination files checksums...`)
        await fs.writeFile(path.join(this.saveOutputFolder, `dest-checksums-${date}.orgz.json`), JSON.stringify(this.destFilesInfo, null, 2));
      }
    }

    await this.loadSourceFilesAndInfo();

    if (this.options.save) {
      await this.saveSourceChecksums(date);
    }

    await this.organizeFilesAndUpdateList();

    if (this.options.save) {
      await fs.writeFile(path.join(this.saveOutputFolder, `file-list-${date}.orgz.json`), JSON.stringify(this.filesList, null, 2));
    }
  }


  _isSrcFileCheckSum(obj: any): obj is SrcFileCheckSum {
    // Check if obj is an object
    if (typeof obj !== 'object' || obj === null) return false;

    // Check each key/value in the object
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];

        // Check if the value is an object with properties 'checkSum' and 'creationDate'
        if (
          typeof value !== 'object' ||
          value === null ||
          typeof value.checkSum !== 'string' ||
          typeof value.creationDate !== 'string'
        ) {
          return false;
        }
      }
    }

    // If all keys pass the check, obj is SrcFileCheckSum
    return true;
  }


  _validateSaveOutputFolder() {
    const saveOutputFolder = path.resolve(this.options.saveOutput);
    const exists = fsSync.existsSync(saveOutputFolder);

    if (!exists) {
      return true;
    }

    return fsSync.statSync(saveOutputFolder).isDirectory();
  }

  _spinnerTextLoadingFiles() {
    const title = `Loading files...`;
    const files = `Files found: ${this.srcFilesCount}`;
    const folders = `Folders found: ${this.foldersCount}`;
    const srcDuplicates = `Duplicated files in source: ${this.srcDuplicationCount}`
    const destDuplicates = `Duplicated files in destination: ${this.destDuplicationCount}`
    const uniqueFiles = `Unique files: ${this.uniqueFilesCount}`;

    return `${title}\n\n${this.currentAction}\n\n${files}\n${folders}\n${uniqueFiles}\n${srcDuplicates}\n${destDuplicates}`;
  }

  async loadSourceFilesCheckSum() {
    if (!fsSync.existsSync(this.options.sourceChecksums)) {
      return;
    }

    try {
      const sourceFilesCheckSum = await fs.readFile(this.options.sourceChecksums, {encoding: "utf-8"});
      const sourceFilesCheckSumObject = JSON.parse(sourceFilesCheckSum);

      // Check if the file format match with SrcFileCheckSum
      if (!this._isSrcFileCheckSum(sourceFilesCheckSumObject)) {
        console.error(`The file ${this.options.sourceChecksums} is not a valid source files checksums file.`);
        process.exit();
      }

      this.srcFilesInfo = sourceFilesCheckSumObject;

    } catch (error: any) {
      console.error(`An error occurred while loading source files checksums.\n\nError: `, error);
    }
  }

  _isDestFileCheckSum(obj: any): obj is DestFileCheckSum {
    // Check if obj is an object
    if (typeof obj !== 'object' || obj === null) return false;

    // Check each key/value in the object
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];

        // Check if the value is a string
        if (typeof value !== 'string') {
          return false;
        }
      }
    }

    // If all keys pass the check, obj is DestFileCheckSum
    return true;
  }

  async loadDestinationFilesCheckSum() {
    if (!fsSync.existsSync(this.options.destinationChecksums)) {
      return;
    }

    try {
      const destinationFilesCheckSum = await fs.readFile(this.options.destinationChecksums, {encoding: "utf-8"});
      const checksums = JSON.parse(destinationFilesCheckSum);

      // Check if the file format match with DestFileCheckSum
      if (!this._isDestFileCheckSum(checksums)) {
        console.error(`The file ${this.options.destinationChecksums} is not a valid destination files checksums file.`);
        // Ask if the user wants to continue without the checksums
        const answer = await readline.question(`Do you want to continue without the checksums? (y/n) `);
        if (answer.toLowerCase() !== "y") {
          process.exit();
        } else {
          return;
        }
      }

      this.destFilesInfo = checksums;
    } catch (error: any) {
      console.error(`An error occurred while loading destination files checksums.\n\nError: `, error);
    }
  }

  async loadFileList(folder: string, updateCallback?: () => Promise<void>): Promise<FileOperation[]> {
    const folderPath = path.resolve(folder);

    let files = await fs.readdir(folderPath, {withFileTypes: true});
    const activeFileList: FileOperation[] = [];

    const mapper = async (file: Dirent) => {
      let pathRes = path.normalize(path.join(folderPath, file.name));

      if (file.isFile()) {
        activeFileList.push({
          folderPath: folderPath,
          path: pathRes,
          action: null,
          newPath: null,
          creationDate: null,
          checkSum: null,
        });

        this.srcFilesCount++;
        updateCallback ? updateCallback() : null;
      } else if (file.isDirectory()) {
        this.foldersCount++;
        updateCallback ? updateCallback() : null;

        const filesInFolder = await this.loadFileList(pathRes, updateCallback);
        activeFileList.push(...filesInFolder);
      }
    };

    await pMap(files, mapper, {concurrency: parseInt(this.options.threads)});

    return activeFileList;
  }

  async loadFilesInfo(files: FileOperation[], updateCallback?: () => Promise<void>) {
    let progress = 0;
    const total = files.length;

    const updateProgress = () => {
      progress++;
      const percentage = ((progress / total) * 100).toFixed(2);
      this.currentAction = `Reading files info: ${progress} of ${total} (${percentage}%)`;
      if (updateCallback) updateCallback();
    }

    const checkSrcDuplications = (checkSum: string, path: string) => {
      if (!this.srcDuplicationMap[checkSum]) {
        this.srcDuplicationMap[checkSum] = [path];
        return false;
      }

      this.srcDuplicationCount++;
      this.srcDuplicationMap[checkSum].push(path);
      return true;
    }

    const checkDestDuplications = (checkSum: string, path: string) => {
      if (!this.destDuplicationMap[checkSum]) {
        this.destDuplicationMap[checkSum] = [path];
        return false;
      }

      this.destDuplicationCount++;
      this.destDuplicationMap[checkSum].push(path);
      return true;
    }

    const mapper = async (file: FileOperation) => {
      if (!this.srcFilesInfo[file.path]) {
        const [creationDate, checkSum] = await Promise.all([
          this.getCreationDate(file.path),
          md5File(file.path),
        ]);

        this.srcFilesInfo[file.path] = {
          checkSum: checkSum,
          creationDate: creationDate,
        };
      }

      file.checkSum = this.srcFilesInfo[file.path].checkSum;
      file.creationDate = this.srcFilesInfo[file.path].creationDate;

      const isSrcDuplicated = checkSrcDuplications(file.checkSum, file.path);
      const isDestDuplicated = checkDestDuplications(file.checkSum, file.path);

      if (!isSrcDuplicated && !isDestDuplicated) {
        this.uniqueFilesCount++;
      }

      updateProgress();
    };

    await pMap(files, mapper, {concurrency: parseInt(this.options.threads)});
  }

  async loadDestinationFiles(folder: string, updateCallback?: () => Promise<void>) {
    const folderPath = path.resolve(folder);

    let files = await fs.readdir(folderPath, {withFileTypes: true});
    const filesCheckSum: string[] = [];

    const mapper = async (file: Dirent) => {
      let pathRes = path.normalize(path.join(folderPath, file.name));

      if (file.isFile()) {
        filesCheckSum.push(pathRes);

        this.destFilesCount++;
        updateCallback ? updateCallback() : null;
      } else if (file.isDirectory()) {
        const filesInFolder = await this.loadDestinationFiles(pathRes, updateCallback);
        filesCheckSum.push(...filesInFolder);
      }
    };

    await pMap(files, mapper, {concurrency: parseInt(this.options.threads)});
    return filesCheckSum;
  }

  async loadDestinationFilesInfo(updateCallback?: () => Promise<void>) {
    let progress = 0;
    const total = this.destFileList.length;
    let newDestFilesInfo: DestFileCheckSum = {};

    const updateProgress = () => {
      progress++;
      this.currentAction = `Reading destination files checksums: ${progress} of ${total} (${((progress / total) * 100).toFixed(2)}%)`;
      if (updateCallback) updateCallback();
    }

    const mapper = async (filePath: string) => {
      newDestFilesInfo[filePath] = this.destFilesInfo[filePath] ? this.destFilesInfo[filePath] : await md5File(filePath);
      updateProgress();
    };

    await pMap(this.destFileList, mapper, {concurrency: parseInt(this.options.threads)});
    // Replace the old checksums with the new ones to remove the deleted files
    this.destFilesInfo = newDestFilesInfo;

    // Add the new files to the destDuplicationMap to check for duplications
    for (const filePath in this.destFilesInfo) {
      if (Object.prototype.hasOwnProperty.call(this.destFilesInfo, filePath)) {
        const checkSum = this.destFilesInfo[filePath];
        this.destDuplicationMap[checkSum] = this.destDuplicationMap[checkSum] ? [...this.destDuplicationMap[checkSum], filePath] : [filePath];
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

  async organizeFiles(filesOperations: FileOperation[], spinner?: Ora) {
    for (let index = 0; index < filesOperations.length; index++) {
      const operation = filesOperations[index];

      if (!operation.checkSum || !operation.creationDate) {
        filesOperations[index].action = Actions.SKIPPED;
        filesOperations[index].error = 'The checksum or the creation date is null.'
        continue;
      }

      const operationDone = this.operationsCheckSumsDone.includes(operation.checkSum);
      if (operationDone) {
        if (this.options.deleteDuplicates && this.options.move) {
          if (spinner) {
            spinner.text = this._buildOperationsSpinnerText(`Deleting duplicate ${operation.path}`);
          }
          filesOperations[index] = await this.operationHandler.tryDeleteFile(operation);
          filesOperations[index].action = Actions.DELETED_DUPLICATE;
          continue;
        }

        filesOperations[index].action = Actions.SKIPPED_DUPLICATE;
        continue;
      }

      const fileExist = !!this.destFilesInfo[operation.path];
      if (fileExist) {
        if (this.options.deleteExist && this.options.move) {
          if (spinner) {
            spinner.text = this._buildOperationsSpinnerText(`Deleting existing ${operation.path}`);
          }
          filesOperations[index] = await this.operationHandler.tryDeleteFile(operation);
          filesOperations[index].action = Actions.DELETED_EXISTING;
          continue;
        }

        filesOperations[index].action = Actions.SKIPPED_EXISTING;
        continue;
      }

      const filePath = operation.path;
      const folderPath = operation.folderPath;
      const newPath = await this.newPathResolver.getNewPath(filePath, folderPath, operation.creationDate);

      if (newPath == null) {
        filesOperations[index].action = Actions.SKIPPED;
        filesOperations[index].error = 'The new path is null or the user skip the file.'
        continue;
      }

      filesOperations[index].newPath = newPath;

      if (this.options.move) {
        if (spinner) {
          spinner.text = this._buildOperationsSpinnerText(`Moving ${operation.path} to ${newPath}`);
        }
        filesOperations[index] = await this.operationHandler.tryMoveFile(operation);
        continue;
      }

      if (this.options.link) {
        if (spinner) {
          spinner.text = this._buildOperationsSpinnerText(`Linking ${operation.path} to ${newPath}`);
        }
        filesOperations[index] = await this.operationHandler.tryLinkFile(operation);
        continue;
      }

      if (spinner) {
        spinner.text = this._buildOperationsSpinnerText(`Copying ${operation.path} to ${newPath}`);
      }
      filesOperations[index] = await this.operationHandler.tryCopyFile(operation);

      this.operationsCheckSumsDone.push(operation.checkSum);

      // Await a few milliseconds to avoid problems with the file system
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return filesOperations;
  }

  _buildOperationsSpinnerText(body: string) {
    const totalOfOperations = (this.options.deleteDuplicates && this.options.move) ? this.srcFilesCount : this.uniqueFilesCount;
    const operations = `Operations done: ${this.operationHandler.operationsDone + this.filesSkippedAlreadyExist} of ${totalOfOperations}`;
    const percent = `(${(((this.operationHandler.operationsDone + this.filesSkippedAlreadyExist) / totalOfOperations) * 100).toFixed(2)}%)`;

    const operationsPercent = `${operations} ${percent}`;
    const errors = `Errors: ${this.operationHandler.operationsErrorCount}`;
    const skipped = `Skipped files: ${this.filesSkippedAlreadyExist}`;
    const action = this.options.move ? "Moving" : this.options.link ? "Linking" : "Copying";
    const title = `${action} files in progress...`;

    return `${title}\n\n${body}\n\n${operationsPercent}\n${errors}\n${skipped}`;
  }
}

export default FileOrganizer;
