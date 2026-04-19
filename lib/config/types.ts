export type RawProjectConfig = {
  path: string;
  name?: string;
  enabled?: boolean;
};

export type AppConfig = {
  projects: RawProjectConfig[];
};

export type ProjectConfig = {
  name: string;
  absolutePath: string;
  slug: string;
  encodedPath: string;
};
