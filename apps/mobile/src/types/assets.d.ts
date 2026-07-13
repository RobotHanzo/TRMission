// Metro resolves a bundled media import to a numeric asset module id (what expo-audio and
// <Image source> consume). Declared here so asset imports typecheck under tsc.
declare module '*.mp3' {
  const asset: number;
  export default asset;
}

declare module '*.png' {
  const asset: number;
  export default asset;
}
