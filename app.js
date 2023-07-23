const fs = require('fs');
var parseArgs = require('minimist');
const { execSync } = require('child_process');
var fecha = require('fecha');
const path = require('path');
const fixPath = require('@ff0000-ad-tech/unix-path-literal');
var readlineSync = require('readline-sync');

// console.log(fs.lstatSync(`/home/cristianrm650/ProyectosActivos/organizer/organizadas/16/12\-04/`));
// readlineSync.question('-- BreakPoint --')

var argv = parseArgs(process.argv.slice(2),{
  default:{
    d:"YYYY/MM/DD",
    m:false,
    u:false,
    extra:true,
    all:false,
    link:false,
    n:false,
    save:false,
    h: false,
    autoname: false
  }
});

if (argv['h']) {
  console.log(`
    Organicer is a cli tool to organize photos by date, instead of using the creation date of the
    file exiftool is used to extract the date from the exif data of the photo.

    Usage: organizer-cli inputFolder outputFolder [options]

    options:
    -d          : Structure to organice the files based on a date format, by default = "YYYY/MM/DD".
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
    --autoname  : Auto rename if exists a file with the same name but it's diferent. By default =
                  false.
    -h          : Shows this text of help.
    `);
  process.exit();
}

var inputFolder = argv["_"][0];
var outputFolder = argv["_"][1];
if (outputFolder[outputFolder.length - 1] != "/") {
  outputFolder = outputFolder + "/";
}

if (!fileExists(inputFolder)) {
  console.log(`La direccion ${inputFolder} no existe.`);
  process.exit();
} else if (!fs.lstatSync(inputFolder).isDirectory()) {
  console.log(`La direccion ${inputFolder} no es un directorio.`);
  process.exit();
}

inputFolder = path.resolve(inputFolder);
inputFolder = path.normalize(inputFolder)

if (inputFolder[inputFolder.length - 1] != "/") {
  inputFolder = inputFolder + "/";
}

var dirFiles = listFiles(inputFolder);
if (argv.extra) {
  dirFiles = moveToExtra(dirFiles);
}
if (argv.all) {
  dirFiles = moveByCreationDate(dirFiles);
}
if (argv.save) {
  console.log("Guardando archivo de organizacion.");

  fs.writeFileSync(inputFolder+"organizer.json",JSON.stringify(dirFiles,null,2));
}

moveFiles(dirFiles);



function listFiles(folder) {
  if (folder[folder.length-1] != "/") {
    folder = folder + "/";
  }
  let f = fs.readdirSync(folder, {
    withFileTypes: true
  });

  let f2 = {
    folders:{},
    files:{}
  };
  for (let i = 0; i < f.length; i++) {
    let pathRes = path.resolve(folder + f[i]["name"]);
    pathRes = path.normalize(pathRes);
    // console.log(pathRes);

    let fileName = f[i].name;
    if (f[i].isFile()) {
      f2["files"][pathRes] = {
        moveTo: moveTo(pathRes,fileName),
        moved:false
      }
    } else if (f[i].isDirectory()) {
      f2["folders"][pathRes] = listFiles(pathRes);
    }
  }
  return f2;
}

function moveTo(filePath,fileName) {
  filePath = fixPath(filePath);
  let creationDate;
  try {
    creationDate = execSync(`exiftool "-createdate" ${filePath}`).toString().match(/[0-9]{4}\:[0-2][0-9]\:[0-3][0-9]/g);
  } catch (error) {
    creationDate = null;
  }

  if (creationDate != null) {
    let pathOut = outputFolder + fecha.format(fecha.parse(creationDate.toString(),"YYYY:MM:DD"),argv.d) + "/" + fileName;
    pathOut = path.resolve(pathOut);
    pathOut = path.normalize(pathOut);
    pathOut = fixPath(pathOut);
    return pathOut;
  } else {
    return null;
  }
}

function moveToExtra(listOfFiles) {
  for (const key in listOfFiles.files) {
    if (listOfFiles.files.hasOwnProperty(key)) {
      const element = listOfFiles.files[key];

      let elementCheck = extraTypes(key);
      if (element.moveTo == null && elementCheck.supported) {

        let keys = Object.keys(listOfFiles.files);
        let originalFile = keys.find(function (fileName){
          // readlineSync.question(`\n\nmatch: ${elementCheck.match}\nkey: ${key}\nkey.slice: ${key.slice(0, -1 * (elementCheck.match.length))} \n`)
          let foo = fileName.search(key.slice(0, -1 * (elementCheck.match.length)));

          if (foo == 0 && listOfFiles.files[fileName].moveTo != null) {
            return true;
          } else {
            return false;
          }
        })
        if (originalFile != undefined) {
          let nameOfFile = key.split("/");
          nameOfFile = nameOfFile[nameOfFile.length-1];
          listOfFiles.files[key].moveTo = listOfFiles.files[originalFile].moveTo.match(/^.*\//g).toString()+nameOfFile;
        }
      }
    }
  }
  if (Object.keys(listOfFiles.folders).length > 0) {
    for (const key in listOfFiles.folders) {
      if (listOfFiles.folders.hasOwnProperty(key)) {
        listOfFiles.folders[key] = moveToExtra(listOfFiles.folders[key]);
      }
    }
  }

  return listOfFiles;
}

function extraTypes(name) {
  let types = [
    ".out.pp3",
    ".pp3",
    ".xcf"
  ]
  let nameOut = {supported: false};
  for (let i = 0; i < types.length; i++) {
    if (name.endsWith(types[i])) {
      nameOut = {
        supported: true,
        match:types[i]
      };
      break;
    }
  }
  return nameOut;
}

function moveByCreationDate(listOfFiles) {
  for (const filePath in listOfFiles.files) {
    if (listOfFiles.files.hasOwnProperty(filePath)) {
      const file = listOfFiles.files[filePath];
      if (file.moveTo == null) {
        let creationDate = fs.statSync(filePath).birthtime;
        let fileName = filePath.split("/")
        listOfFiles.files[filePath].moveTo = outputFolder + fecha.format(creationDate,argv.d) + "/" + fileName[fileName.length-1];
      }
    }
  }
  if (Object.keys(listOfFiles.folders).length > 0) {
    for (const key in listOfFiles.folders) {
      if (listOfFiles.folders.hasOwnProperty(key)) {
        listOfFiles.folders[key] = moveByCreationDate(listOfFiles.folders[key]);
      }
    }
  }

  return listOfFiles;
}

function moveFiles(listOfFiles) {
  for (const filePath in listOfFiles.files) {
    if (listOfFiles.files.hasOwnProperty(filePath)) {
      const file = listOfFiles.files[filePath];
      if (file.moveTo != null) {
        let checks = checkBeforeAction(filePath, file.moveTo);
        if (!checks.continue) {
          console.log(checks.error);
        } else {
          if (checks.changeName) {
            file.moveTo = checks.newName;
          } else if (checks.replace) {
            file.moveTo += ' -f'
          }
          let actionLog = "";
          if (filePath.replace(/\\/g, '').length > (process.stdout.columns - 6) / 2) {
            actionLog += ".." + filePath.replace(/\\/g, '').slice(-1 * ((process.stdout.columns - 8) / 2), 5000) + " => ";
          } else {
            actionLog += filePath.replace(/\\/g, '') + " => ";
          }
          if (file.moveTo.replace(/\\/g, '').length > (process.stdout.columns - 6) / 2) {
            actionLog += ".." + file.moveTo.replace(/\\/g, '').slice(-1 * ((process.stdout.columns - 8) / 2), 5000);
          } else {
            actionLog += file.moveTo.replace(/\\/g, '');
          }
          console.log(actionLog);

          if (!argv.n) {
            if (argv.m) {
              // Movemos los archivos
              execSync(`mv ${fixPath(filePath)} ${file.moveTo}`);
            } else if (argv.link) {
              // Creamos enlaces duros
              execSync(`cp -l ${fixPath(filePath)} ${file.moveTo}`);
            } else {
              // Hacemos una copia de los archivos
              execSync(`cp ${fixPath(filePath)} ${file.moveTo}`);
            }
          }
        }
      }
    }
  }

  if (Object.keys(listOfFiles.folders).length > 0) {
    for (const key in listOfFiles.folders) {
      if (listOfFiles.folders.hasOwnProperty(key)) {
        listOfFiles.folders[key] = moveFiles(listOfFiles.folders[key]);
      }
    }
  }
}

function fileExists(path) {
  if (path == null || path == undefined) {
    return false;
  } else if (fs.existsSync(path.toString().replace(/\\/g,""))) {
    return true;
  } else {
    return false;
  }
}

function checkBeforeAction(pathInput, pathOut) {
  pathInput = pathInput.replace(/\\/g,'');
  pathOut = pathOut.replace(/\\/g,'');

  let resp = {
    continue: false,
    changeName: false,
    newName: "",
    replace: false,
    error: null
  }

  let dirOutput = pathOut.match(/^.*\//g).toString()
  if (!fileExists(dirOutput)) {
    if (!argv.n) {
      console.log(`Creando directorio ${fixPath(dirOutput)}`);
      execSync(`mkdir -p ${fixPath(dirOutput)}`);
    }
  } else if (!fs.lstatSync(dirOutput).isDirectory()) {
    resp.error = `No se puede crear la carpeta de destino ${dirOutput} por que ya existe un archivo con el mismo nombre.`;
    return resp;
  }

  if (fileExists(pathOut)) {
    if (fs.lstatSync(pathOut).isDirectory()) {
      resp.error = `No se puede escribir el archivo ${pathOut} por que existe una carpeta con el mismo nombre.`;
      return resp;
    }

    let md5In = execSync(`md5sum ${fixPath(pathInput)}`).toString().match(/^[a-zA-Z0-9]*/g).toString();
    let md5Out = execSync(`md5sum ${fixPath(pathOut)}`).toString().match(/^[a-zA-Z0-9]*/g).toString();

    if (md5In == md5Out) {

      resp.error = `El archivo ${pathOut} ya existe y es igual.`;
      return resp;

    } else if (argv['autoname']) {
      let newName;
      let count = 1;
      do {
        count++;
        let firstPart = pathOut.match(/^.*\/[^.]+/g).toString();
        let extension = pathOut.match(/(^.*\/[^.]+)(.*)/)[2]
        newName = `${firstPart}-${count}${extension}`;
      } while (fileExists(newName));
      resp.continue = true;
      resp.changeName = true;
      resp.newName = fixPath(newName);
      return resp;
    } else {

      let changeName = readlineSync.question(`Ya existe un archivo con el nombre: ${pathOut} pero es distinto.
  Elija una opcion:
  (1) Remplazar.
  (2) Renombrar.
  (3) Ignorar.`).toString().toLowerCase();
      if (changeName == "2" || changeName == "renombrar") {
        changeName = readlineSync.question("Ingrese el nuevo nombre (Incluyendo extensión extension): ");
        resp.continue = true;
        resp.changeName = true;
        resp.newName = fixPath(dirOutput+changeName);
        return resp;
      } else if (changeName == "1" || changeName == "remplazar") {
        resp.continue = true;
        resp.replace = true;
        return resp;
      }

      resp.error = `El archivo ${pathInput} sera ignorado.`;
      return resp;
    }
  } else {
    resp.continue = true;
    return resp;
  }
}
