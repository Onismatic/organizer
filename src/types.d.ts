type OperationsCheckSumsDone = string[];

type FileOperation = {
  folderPath: string;
  path: string;
  newPath: string | null;
  action: Actions | null;
  creationDate: string | null;
  checkSum: string | null;
  error?: string;
}

type SrcFileCheckSum = {
  [path: string]: {
    checkSum: string;
    creationDate: string;
  }
}

type HashedPaths = {
  [checkSum: string]: string[];
}

type DestFileCheckSum = {
  [path: string]: string;
}
