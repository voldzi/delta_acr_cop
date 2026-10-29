export const copApiDirectory: string;
export interface CopApiStartOperations {
  changeDirectory?: (directory: string) => void;
  loadApi?: () => Promise<unknown>;
}
export function startCopApi(operations?: CopApiStartOperations): Promise<void>;
