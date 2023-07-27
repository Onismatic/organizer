import FileOperationHandler from "./FileOperationHandler";
import {Actions} from "./FileOrganizer";

class OperationHandler {
  public operationsDone: number = 0;
  public operationsErrorCount: number = 0;

  constructor(private fileOperationHandler: FileOperationHandler) {}

  async handleFileOperation(fileOperation: FileOperation, action: Actions, operation: Function) {
    try {
      await operation(fileOperation.path, fileOperation.newPath);
      fileOperation.action = action;
      this.operationsDone++;
    } catch (error: any) {
      fileOperation.action = Actions.ERROR;
      fileOperation.error = error.message;
      this.operationsErrorCount++;
    }
    return fileOperation;
  }

  async tryCopyFile(fileOperation: FileOperation) {
    return await this.handleFileOperation(fileOperation, Actions.COPIED, this.fileOperationHandler.copyFile.bind(this.fileOperationHandler));
  }

  async tryLinkFile(fileOperation: FileOperation) {
    return await this.handleFileOperation(fileOperation, Actions.LINKED, this.fileOperationHandler.linkFile.bind(this.fileOperationHandler));
  }

  async tryMoveFile(fileOperation: FileOperation) {
    return await this.handleFileOperation(fileOperation, Actions.MOVED, this.fileOperationHandler.moveFile.bind(this.fileOperationHandler));
  }

  async tryDeleteFile(fileOperation: FileOperation) {
    return await this.handleFileOperation(fileOperation, Actions.DELETED, this.fileOperationHandler.deleteFile.bind(this.fileOperationHandler));
  }
}

export default OperationHandler;
