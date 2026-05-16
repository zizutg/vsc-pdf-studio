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

export interface AnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationHighlight {
  id: string;
  color: string;
  page: number;
  viewportWidth: number;
  viewportHeight: number;
  rects: AnnotationRect[];
}

export interface AnnotationDocument {
  version: 1;
  updatedAt: string;
  strokes: AnnotationStroke[];
  highlights: AnnotationHighlight[];
}

export const emptyAnnotationDocument = (): AnnotationDocument => ({
  version: 1,
  updatedAt: new Date(0).toISOString(),
  strokes: [],
  highlights: []
});
