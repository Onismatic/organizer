import fsSync from 'fs';
import parseArgs from 'minimist';
import path from 'path';
import FileOrganizer from './FileOrganizer.js';

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

