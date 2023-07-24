import path from "path";
import fsSync from "fs";
import { OrganizerOptions } from "./app.js";

class ArgumentsValidator {
  options: OrganizerOptions;
  inputFolder: string;
  outputFolder: string;

  constructor(inputFolder: string, outputFolder: string, options: OrganizerOptions) {
    this.inputFolder = inputFolder;
    this.outputFolder = outputFolder;
    this.options = options;

    if (this.options.help) {
      process.exit();
      return;
    }

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

  normalizePath(dir: string) {
    return path.normalize(path.resolve(dir));
  }

  isDirectory(dir: string) {
    try {
      return fsSync.statSync(dir).isDirectory();
    } catch (err) {
      return false;
    }
  }
}

export default ArgumentsValidator;
