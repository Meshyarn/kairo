export type ContentSourceInline = {
  kind: "inline";
  text: string;
};

export type ContentSourceBase64 = {
  kind: "base64";
  base64: string;
  charset?: "utf8";
};

export type ContentSourceFile = {
  kind: "file";
  path: string;
};

export type ContentSourceArtifact = {
  kind: "artifact";
  id: string;
};

export type ContentSource =
  | ContentSourceInline
  | ContentSourceBase64
  | ContentSourceFile
  | ContentSourceArtifact;

