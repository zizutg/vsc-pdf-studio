export interface AnnotationPoint {
  x: number;
  y: number;
}

export interface AnnotationStroke {
  id: string;
  color: string;
  width: number;
  page: number;
  viewportWidth: number;
  viewportHeight: number;
  points: AnnotationPoint[];
}

export interface AnnotationDocument {
  version: 1;
  updatedAt: string;
  strokes: AnnotationStroke[];
}

export const emptyAnnotationDocument = (): AnnotationDocument => ({
  version: 1,
  updatedAt: new Date(0).toISOString(),
  strokes: []
});
