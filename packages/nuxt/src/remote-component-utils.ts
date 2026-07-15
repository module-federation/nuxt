export interface RemoteComponent {
  componentName: string;
  exposedName: string;
  exportName: string;
  importPath: string;
  remoteName: string;
}

export function createRemoteComponent(
  remoteName: string,
  exposedName: string,
  remoteCount: number,
): RemoteComponent {
  const componentSuffix = toPascalCase(exposedName);
  const componentName =
    remoteCount === 1
      ? `Remote${componentSuffix}`
      : `Remote${toPascalCase(remoteName)}${componentSuffix}`;

  return {
    componentName,
    exposedName,
    exportName: `mfRemote${toPascalCase(remoteName)}_${componentSuffix}`,
    importPath: `${remoteName}/${exposedName}`,
    remoteName,
  };
}

export function assertUniqueRemoteComponents(components: RemoteComponent[]) {
  const componentNames = new Map<string, RemoteComponent>();
  const exportNames = new Map<string, RemoteComponent>();

  for (const component of components) {
    assertUniqueRemoteComponentName(
      componentNames,
      component.componentName,
      component,
      "Nuxt component",
    );
    assertUniqueRemoteComponentName(
      exportNames,
      component.exportName,
      component,
      "generated export",
    );
  }
}

export function createRemoteRefProxy(
  target: Record<PropertyKey, unknown>,
  getValue: () => object | null | undefined,
) {
  return new Proxy(target, {
    get(target, key, receiver) {
      if (Reflect.has(target, key)) {
        return Reflect.get(target, key, receiver);
      }
      const value = getValue();
      if (value == null) return;
      const property = Reflect.get(value, key, value);
      return typeof property === "function" ? property.bind(value) : property;
    },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (descriptor) return descriptor;

      const value = getValue();
      const remoteDescriptor = value
        ? Reflect.getOwnPropertyDescriptor(value, key)
        : undefined;
      return remoteDescriptor
        ? { ...remoteDescriptor, configurable: true }
        : undefined;
    },
    has(target, key) {
      const value = getValue();
      return (
        Reflect.has(target, key) || (value != null && Reflect.has(value, key))
      );
    },
    ownKeys(target) {
      const keys = new Set(Reflect.ownKeys(target));
      const value = getValue();
      if (value) {
        for (const key of Reflect.ownKeys(value)) keys.add(key);
      }
      return [...keys];
    },
    set(target, key, value, receiver) {
      if (Reflect.has(target, key)) {
        return Reflect.set(target, key, value, receiver);
      }
      const remote = getValue();
      return remote == null || Reflect.set(remote, key, value, remote);
    },
  });
}

function assertUniqueRemoteComponentName(
  names: Map<string, RemoteComponent>,
  normalizedName: string,
  component: RemoteComponent,
  kind: string,
) {
  const existing = names.get(normalizedName);
  if (existing && existing.importPath !== component.importPath) {
    throw new Error(
      `[module-federation] Remote components ${JSON.stringify(existing.importPath)} and ${JSON.stringify(component.importPath)} both normalize to the same ${kind} ${JSON.stringify(normalizedName)}. Rename one remote or expose.`,
    );
  }
  names.set(normalizedName, component);
}

function toPascalCase(value: string) {
  return value
    .replace(/^\.\//, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
