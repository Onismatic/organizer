import fs from "fs/promises";
import path from "path";
import { ExifTool } from "exiftool-vendored";
import fecha from "fecha";
import fsSync from "fs";
import * as readlinePromises from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
const readline = readlinePromises.createInterface({input, output});
import { OrganizerOptions } from "./app";

type FileStructure = {
  folders: { [key: string]: FileStructure };
  files: { [key: string]: { moveTo: string; moved: boolean } };
};

class FileOrganizer {
  inputFolder: string;
  outputFolder: string;
  options: OrganizerOptions;
  exiftool: ExifTool;

  constructor(inputFolder: string, outputFolder: string, options: OrganizerOptions) {
    this.inputFolder = inputFolder;
    this.outputFolder = outputFolder;
    this.options = options;
    this.exiftool = new ExifTool({taskTimeoutMillis: 5000});
  }

  async organize() {
    let dirFiles = await this.listFiles(this.inputFolder);
    if (this.options.extra) {
      dirFiles = this.moveToExtra(dirFiles);
    }
    if (this.options.all) {
      dirFiles = this.moveByCreationDate(dirFiles);
    }
    if (this.options.save) {
      console.log("Saving organization file.");

      await fs.writeFile(this.inputFolder + "organizer.json", JSON.stringify(dirFiles, null, 2));
    }

    await this.moveFiles(dirFiles);
  }

  async listFiles(folder: string): Promise<FileStructure> {
    if (folder[folder.length - 1] != "/") {
      folder = folder + "/";
    }

    let files = await fs.readdir(folder, {withFileTypes: true});

    let fileStructure: FileStructure = {folders: {}, files: {}};

    for (const file of files) {
      let pathRes = path.normalize(path.resolve(folder + file.name));

      if (file.isFile()) {
        const moveTo = await this.moveTo(pathRes, file.name);
        if (moveTo) {
          fileStructure["files"][pathRes] = {
            moveTo,
            moved: false,
          }
        }
      } else if (file.isDirectory()) {
        fileStructure["folders"][pathRes] = await this.listFiles(pathRes);
      }
    }

    return fileStructure;
  }

  async getCreationDate(filePath: string) {
    const tags = await this.exiftool.read(filePath, ["CreateDate"]);
    return tags.CreateDate;
  }

  async moveTo(filePath: string, fileName: string) {
    let creationDate = null;

    try {
      creationDate = await this.getCreationDate(filePath);
      creationDate = typeof creationDate == "string" ? creationDate : creationDate?.toISOString() || null;

      if (creationDate) {
        creationDate = fecha.format(new Date(creationDate), this.options.date);
      } else {
        creationDate = fecha.format(fsSync.statSync(filePath).birthtime, this.options.date);
      }
    } catch (error: any) {
      console.log(`An error occurred while getting creation date for file ${filePath}. Error: ${error.message}`);
      return null;
    }

    let moveToFolder = this.outputFolder + creationDate + "/";
    let moveTo = moveToFolder + fileName;

    return await this.checkExist(moveTo, fileName, moveToFolder);
  }

  async checkExist(moveTo: string, fileName: string, moveToFolder: string) {
    if (fsSync.existsSync(moveTo)) {
      if (this.options.autoname) {
        let i = 0;
        while (fsSync.existsSync(moveToFolder + "(" + i + ")" + fileName)) {
          i++;
        }
        return moveToFolder + "(" + i + ")" + fileName;
      } else {
        if (!this.options.dryRun) {
          let answer = await readline.question(`The file ${moveTo} exists, do you want to replace it? (Y/N): `);
          if (answer.toLowerCase() == "y") {
            return moveTo;
          } else {
            console.log(`Skipped file ${fileName}`);
            return null;
          }
        }
      }
    } else {
      return moveTo;
    }
  }

  moveToExtra(dirFiles: FileStructure) {
    for (let file in dirFiles.files) {
      if (file.endsWith(".out.pp3") || file.endsWith(".pp3") || file.endsWith(".xcf")) {
        let imageName = file.substring(0, file.lastIndexOf("."));
        for (let checkFile in dirFiles.files) {
          if (checkFile == imageName + ".jpg" || checkFile == imageName + ".JPG" || checkFile == imageName + ".jpeg" || checkFile == imageName + ".JPEG" || checkFile == imageName + ".png" || checkFile == imageName + ".PNG") {
            dirFiles.files[file].moveTo = dirFiles.files[checkFile].moveTo + file.substring(file.lastIndexOf("."));
          }
        }
      }
    }

    return dirFiles;
  }

  moveByCreationDate(dirFiles: FileStructure) {
    for (let file in dirFiles.files) {
      if (!dirFiles.files[file].moveTo) {
        let creationDate = fecha.format(fsSync.statSync(file).birthtime, this.options.date);
        dirFiles.files[file].moveTo = this.outputFolder + creationDate + "/" + path.basename(file);
      }
    }

    return dirFiles;
  }

  async moveFiles(dirFiles: FileStructure) {
    for (let folder in dirFiles.folders) {
      await this.moveFiles(dirFiles.folders[folder]);
    }

    for (let file in dirFiles.files) {
      if (!this.options.dryRun && dirFiles.files[file].moveTo) {
        try {
          if (!fsSync.existsSync(path.dirname(dirFiles.files[file].moveTo))) {
            await fs.mkdir(path.dirname(dirFiles.files[file].moveTo), {recursive: true});
          }

          if (this.options.move) {
            await fs.rename(file, dirFiles.files[file].moveTo);
          } else {
            if (this.options.link) {
              fsSync.linkSync(file, dirFiles.files[file].moveTo);
            } else {
              await fs.copyFile(file, dirFiles.files[file].moveTo);
            }
          }

          dirFiles.files[file].moved = true;
        } catch (error: any) {
          console.log(`An error occurred while moving/copying file ${file}. Error: ${error.message}`);
        }
      }
    }
  }
}

export default FileOrganizer;
