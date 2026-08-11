// Re-export from npm package (visibility-polygon by Byron Knoll)
// The package exposes named functions only — bundle them into a namespace
// object so existing PolyVisibility.xxx() call sites keep working.
import * as VisibilityPolygon from 'visibility-polygon';

const PolyVisibility = VisibilityPolygon;
export default PolyVisibility;
