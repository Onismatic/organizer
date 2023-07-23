import fs from 'fs/promises';
import fsSync from 'fs';
import parseArgs from 'minimist';
import { execSync } from 'child_process';
import fecha from 'fecha';
import path from 'path';
import fixPath from '@ff0000-ad-tech/unix-path-literal';
import readlineSync from 'readline-sync';

class Argv {
  constructor() {
    this.argv = parseArgs(process.argv.slice(2), {
      default: {
        d: "YYYY/MM/DD",
        m: false,
        u: false,
        extra: true,
        all: false,
        link: false,
        n: false,
        save: false,
        h: false,
        autoname: false,
      }
    });

    if (this.argv.h) this.printHelp();

    this.inputFolder = this.argv._[0];
    console.log(this.inputFolder)
    this.outputFolder = this.argv._[1];
    if (this.outputFolder[this.outputFolder.length - 1] != "/") {
      this.outputFolder = this.outputFolder + "/";
    }

    if (!this.isDirectory(this.inputFolder)) {
      console.log(`The path ${this.inputFolder} does not exist or is not a directory.`);
      process.exit();
    }

    this.inputFolder = this.normalizePath(this.inputFolder);
    if (this.inputFolder[this.inputFolder.length - 1] != "/") {
      this.inputFolder = this.inputFolder + "/";
    }
  }

  normalizePath(dir) {
    return path.normalize(path.resolve(dir));
  }

  isDirectory(dir) {
    try {
      return fsSync.statSync(dir).isDirectory();
    } catch (err) {
      return false;
    }
  }

  printHelp() {
    console.log(`
      Organicer is a cli tool to organize photos by date, instead of using the creation date of the
      file exiftool is used to extract the date from the exif data of the photo.

      Usage: organizer-cli inputFolder outputFolder [options]

      options:
      -d          : Structure to organize the files based on a date format, by default = "YYYY/MM/DD".
      -m          : Move files instead of copy them. By default = false.
      --extra     : Check extra file types support (.out.pp3, .pp3, .xcf), for these type of files the
                    organizer check if exist a file with the same name in the same directory and move
                    to the same location. By default = true.
      --all       : Check move/copy the rest of the files using the creation date. By default = false.
      --link      : Make hard links instead of copy the files (Only work if -m == false). By default =
                    false.
      -n          : Dry run, don't exec operations. By default = false.
      --save      : Save a .json file with the operations to be performed or that have been done (Work
                    even on Dry run). By default = false.
      --autoname  : Auto rename if exists a file with the same name but it's different. By default =
                    false.
      -h          : Shows this text of help.
      `);
    process.exit();
  }
}

class FileOrganizer {
  constructor(inputFolder, outputFolder, argv) {
    this.inputFolder = inputFolder;
    this.outputFolder = outputFolder;
    this.argv = argv;
  }

  async organize() {
    let dirFiles = await this.listFiles(this.inputFolder);
    if (this.argv.extra) {
      dirFiles = this.moveToExtra(dirFiles);
    }
    if (this.argv.all) {
      dirFiles = this.moveByCreationDate(dirFiles);
    }
    if (this.argv.save) {
      console.log("Saving organization file.");

      await fs.writeFile(this.inputFolder + "organizer.json", JSON.stringify(dirFiles, null, 2));
    }

    await this.moveFiles(dirFiles);
  }

  async listFiles(folder) {
    if (folder[folder.length - 1] != "/") {
      folder = folder + "/";
    }

    let files = await fs.readdir(folder, { withFileTypes: true });

    let fileStructure = { folders: {}, files: {} };

    for (const file of files) {
      let pathRes = path.normalize(path.resolve(folder + file.name));

      if (file.isFile()) {
        fileStructure["files"][pathRes] = { moveTo: this.moveTo(pathRes, file.name), moved: false };
      } else if (file.isDirectory()) {
        fileStructure["folders"][pathRes] = await this.listFiles(pathRes);
      }
    }

    return fileStructure;
  }

  moveTo(filePath, fileName) {
    let creationDate;
    try {
      creationDate = execSync(`exiftool "-createdate" ${fixPath(filePath)}`).toString().match(/[0-9]{4}\:]{2}:[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/);
      if (creationDate != null) {
        creationDate = fecha.format(new Date(creationDate[0]), this.argv.d);
      } else {
        creationDate = fecha.format(fsSync.statSync(filePath).birthtime, this.argv.d);
      }
    } catch (error) {
      console.log(`An error occured while getting creation date for file ${filePath}. Error: ${error.message}`);
      return null;
    }

    let moveToFolder = this.outputFolder + creationDate + "/";
    let moveTo = moveToFolder + fileName;

    return this.checkExist(moveTo, fileName, moveToFolder);
  }

  checkExist(moveTo, fileName, moveToFolder) {
    if (fsSync.existsSync(moveTo)) {
      if (this.argv.autoname) {
        let i = 0;
        while (fsSync.existsSync(moveToFolder + "(" + i + ")" + fileName)) {
          i++;
        }
        return moveToFolder + "(" + i + ")" + fileName;
      } else {
        if (!this.argv.n) {
          let answer = readlineSync.question(`The file ${moveTo} exists, do you want to replace it? (Y/N): `);
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

  moveToExtra(dirFiles) {
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

  moveByCreationDate(dirFiles) {
    for (let file in dirFiles.files) {
      if (!dirFiles.files[file].moveTo) {
        let creationDate = fecha.format(fsSync.statSync(file).birthtime, this.argv.d);
        dirFiles.files[file].moveTo = this.outputFolder + creationDate + "/" + path.basename(file);
      }
    }

    return dirFiles;
  }

  async moveFiles(dirFiles) {
    for (let folder in dirFiles.folders) {
      await this.moveFiles(dirFiles.folders[folder]);
    }

    for (let file in dirFiles.files) {
      if (!this.argv.n && dirFiles.files[file].moveTo) {
        try {
          if (!fsSync.existsSync(path.dirname(dirFiles.files[file].moveTo))) {
            await fs.mkdir(path.dirname(dirFiles.files[file].moveTo), { recursive: true });
          }

          if (this.argv.m) {
            await fs.rename(file, dirFiles.files[file].moveTo);
          } else {
            if (this.argv.link) {
              fsSync.linkSync(file, dirFiles.files[file].moveTo);
            } else {
              await fs.copyFile(file, dirFiles.files[file].moveTo);
            }
          }

          dirFiles.files[file].moved = true;
        } catch (error) {
          console.log(`An error occurred while moving/copying file ${file}. Error: ${error.message}`);
        }
      }
    }
  }
}

async function main() {
  const argv = new Argv();

  const fileOrganizer = new FileOrganizer(argv.inputFolder, argv.outputFolder, argv.argv);
  await fileOrganizer.organize();

  console.log("Organization complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

