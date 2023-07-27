import fecha from 'fecha';
import path from 'path';
import fsSync from 'fs';
import * as readlinePromises from 'node:readline/promises';
import {stdin as input, stdout as output} from "process";
import {OrganizerOptions} from "./app";

class NewPathResolver {
  private readline = readlinePromises.createInterface({input, output});
  constructor(
    private outputFolder: string,
    private dateFormat: OrganizerOptions['dateFormat'],
    private interactive: OrganizerOptions['interactive'],
    private dryRun: OrganizerOptions['dryRun'],
  ) {}

  async getNewPath(fileSrcPath: string, folderPath: string, creationDate: string) {
    try {
      let formatCreationDate = fecha.format(new Date(creationDate), this.dateFormat)
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

    if (this.interactive && !this.dryRun) {
      // Ask the user what to do
      let answer = null;
      do {
        answer = await this.readline.question(`File ${fileName} already exist in ${moveToFolder}, what do you want to do?\n1. Skip file\n2. Rename file\n3. Replace file`);
      } while (answer != "1" && answer != "2" && answer != "3");

      switch (answer) {
        case "1":
          return null;
        case "2":
          let newFileName = null;
          do {
            newFileName = await this.readline.question(`New file name for ${fileName}: `);
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
}

export default NewPathResolver;
