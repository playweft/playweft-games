export type Player = 'black' | 'white';
export type BoardState = (Player | null)[][];
export type FloatArray = Float32Array | number[];
export type GameRules = 'japanese' | 'chinese' | 'korean' | 'aga' | 'new-zealand' | 'tromp-taylor' | 'stone-scoring';
export interface Move { x: number; y: number; player: Player; }
export interface RegionOfInterest { xMin: number; xMax: number; yMin: number; yMax: number; }
