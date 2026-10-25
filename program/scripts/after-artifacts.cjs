'use strict';
// Keep the versioned, concise PDF beside every installer, including builds
// that override the release output directory from the command line.
exports.default=async function(context){return [await require('./quickstart.cjs').buildGuide(context.outDir)];};
