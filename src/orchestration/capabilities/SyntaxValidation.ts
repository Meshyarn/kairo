export type SyntaxIssue = {
    line: number;
    column: number;
    message: string;
};

export interface ISyntaxValidationProvider {
    validate(filePath: string, content: string): Promise<SyntaxIssue[]>;
}
