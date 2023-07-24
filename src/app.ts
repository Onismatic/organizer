import { Command } from '@commander-js/extra-typings';
import FileOrganizer from './FileOrganizer.js';
import ArgumentsValidator from "./ArgumentsValidator.js";

const program = new Command()
  .name('organizer-cli')
  .version('0.0.1')
  .description('Organizer is a cli tool to organize photos by date, instead of using the creation date of the file exiftool is used to extract the date from the exif data of the photo.')
  .addHelpText('after', 'Usage: organizer-cli inputFolder outputFolder [options]')
  .arguments('<inputFolder> <outputFolder>')
  .option('-d, --date <date>', 'Structure to organize the files based on a date format, by default = "YYYY/MM/DD".', 'YYYY/MM/DD')
  .option('-m, --move', 'Move files instead of copy them. By default = false.', false)
  .option('--extra', 'Check extra file types support (.out.pp3, .pp3, .xcf), for these type of files the organizer check if exist a file with the same name in the same directory and move to the same location. By default = true.', true)
  .option('--all', 'Check move/copy the rest of the files using the creation date. By default = false.', false)
  .option('--link', 'Make hard links instead of copy the files (Only work if -m == false). By default = false.', false)
  .option('-n, --dry-run', 'Dry run, don\'t exec operations. By default = false.', false)
  .option('--save', 'Save a .json file with the operations to be performed or that have been done (Work even on Dry run). By default = false.', false)
  .option('--autoname', 'Auto rename if exists a file with the same name but it\'s different. By default = false.', false)
  .option('-h, --help', 'Shows this text of help.')
  .parse();

export type OrganizerOptions = ReturnType<typeof program.opts>;

async function main() {
  const args = new ArgumentsValidator(program.args[0], program.args[1], program.opts());

  const fileOrganizer = new FileOrganizer(args.inputFolder, args.outputFolder, args.options);
  await fileOrganizer.organize();

  console.log("Organization complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

