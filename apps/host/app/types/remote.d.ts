// Fallback until the remote's MF types are downloaded into `@mf-types`. A
// wildcard declaration lets those downloaded types take precedence.
declare module "remote/bridge/*" {
  const createProvider: () => {
    render: (info: Record<string, unknown>) => void | Promise<void>;
    destroy: (info: { dom: HTMLElement }) => void;
  };
  export default createProvider;
}
