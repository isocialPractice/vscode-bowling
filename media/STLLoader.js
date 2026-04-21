/**
 * STLLoader for Three.js UMD build
 * Adapted from three.js examples
 */
(function() {
    'use strict';

    THREE.STLLoader = function(manager) {
        this.manager = (manager !== undefined) ? manager : THREE.DefaultLoadingManager;
    };

    THREE.STLLoader.prototype = {
        constructor: THREE.STLLoader,

        load: function(url, onLoad, onProgress, onError) {
            const scope = this;
            const loader = new THREE.FileLoader(scope.manager);
            loader.setResponseType('arraybuffer');
            loader.load(url, function(text) {
                try {
                    onLoad(scope.parse(text));
                } catch (e) {
                    if (onError) {
                        onError(e);
                    } else {
                        console.error(e);
                    }
                    scope.manager.itemError(url);
                }
            }, onProgress, onError);
        },

        parse: function(data) {
            function isBinary(data) {
                const reader = new DataView(data);
                const numFaces = reader.getUint32(80, true);
                const faceSize = (32 / 8 * 3) + ((32 / 8 * 3) * 3) + (16 / 8);
                const numExpectedBytes = 80 + 32 / 8 + numFaces * faceSize;
                if (numExpectedBytes === reader.byteLength) {
                    return true;
                }
                const solid = [115, 111, 108, 105, 100];
                for (let i = 0; i < 5; i++) {
                    if (solid[i] !== reader.getUint8(i)) return true;
                }
                return false;
            }

            function parseBinary(data) {
                const reader = new DataView(data);
                const faces = reader.getUint32(80, true);
                let dataOffset = 84;
                const geometry = new THREE.BufferGeometry();
                const vertices = [];
                const normals = [];

                for (let face = 0; face < faces; face++) {
                    const nx = reader.getFloat32(dataOffset, true);
                    const ny = reader.getFloat32(dataOffset + 4, true);
                    const nz = reader.getFloat32(dataOffset + 8, true);
                    dataOffset += 12;

                    for (let i = 0; i < 3; i++) {
                        const x = reader.getFloat32(dataOffset, true);
                        const y = reader.getFloat32(dataOffset + 4, true);
                        const z = reader.getFloat32(dataOffset + 8, true);
                        dataOffset += 12;

                        vertices.push(x, y, z);
                        normals.push(nx, ny, nz);
                    }

                    dataOffset += 2;
                }

                geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
                return geometry;
            }

            function parseASCII(data) {
                const geometry = new THREE.BufferGeometry();
                const vertices = [];
                const normals = [];
                const patternSolid = /solid([\s\S]*?)endsolid/g;
                const patternFace = /facet([\s\S]*?)endfacet/g;
                const patternFloat = /[\s]+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;

                let text;
                if (data instanceof ArrayBuffer) {
                    const decoder = new TextDecoder();
                    text = decoder.decode(data);
                } else {
                    text = data;
                }

                const solidsData = [];
                let solid;
                while ((solid = patternSolid.exec(text)) !== null) {
                    solidsData.push(solid);
                }

                for (let i = 0; i < solidsData.length; i++) {
                    const solidData = solidsData[i];
                    let face;
                    while ((face = patternFace.exec(solidData[0])) !== null) {
                        const faceData = face[0];
                        const vertexCountPerFace = 3;
                        const normalCountPerFace = 3;
                        const result = [];
                        let number;
                        while ((number = patternFloat.exec(faceData)) !== null) {
                            result.push(parseFloat(number[1]));
                        }

                        const normal = new THREE.Vector3(result[0], result[1], result[2]);

                        for (let j = 0; j < vertexCountPerFace; j++) {
                            vertices.push(result[normalCountPerFace + (j * 3) + 0]);
                            vertices.push(result[normalCountPerFace + (j * 3) + 1]);
                            vertices.push(result[normalCountPerFace + (j * 3) + 2]);
                            normals.push(normal.x, normal.y, normal.z);
                        }
                    }
                }

                geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
                return geometry;
            }

            return isBinary(data) ? parseBinary(data) : parseASCII(data);
        }
    };
})();
