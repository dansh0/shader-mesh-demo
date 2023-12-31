import * as THREE from 'three'
import { OrbitControls } from './jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from './jsm/geometries/RoundedBoxGeometry.js'
import { TeapotGeometry } from './jsm/geometries/TeapotGeometry.js'
import Stats from './jsm/libs/stats.module.js'
import { GUI } from './jsm/libs/lil-gui.module.min.js'

// Shaders!
const vert = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    varying vec3 vProjPos;

    void main() {
        vNormal = normal;
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        vWorldPos = vec3(mvPosition);
        gl_Position = projectionMatrix * mvPosition;
        vProjPos = vec3(gl_Position);
    }
`

const fragDepth = `
    // uniform sampler2D uDepthPeelTex;
    uniform sampler2D uOutputRef;
    // uniform bool uBackFace;

    // RGBA Unpacking
    float unpackRGBAToDepth(vec4 color) {
        const vec4 bitShifts = vec4(1.0 / (256.0 * 256.0 * 256.0), 1.0 / (256.0 * 256.0), 1.0 / 256.0, 1.0);
        float depth = dot(color, bitShifts);
        return depth;
    }

    void main() {

        // Find previous depth values
        vec2 uv = gl_FragCoord.xy/vec2(textureSize(uOutputRef, 0));
        float prevDepth = unpackRGBAToDepth(texture2D( uOutputRef, uv));
        float currentDepth;

        // Test if it is behind first depth value (Peel away first depth)
        if (gl_FragCoord.z < prevDepth) {
            discard;
            return;
        } else {
            // New depth is the depth of the next fragment that passes
            currentDepth = (1.0-gl_FragCoord.z);
        }

        // Output
        gl_FragColor = vec4(currentDepth);

    }
`


const fragMain = `
    #define MAX_STEPS 10000
    #define MAX_DIST 200.
    #define MIN_DIST 0.01
    #define NORM_EPS 0.01
    #define PI 3.141592
    #define TAU 6.283185

    varying vec3 vNormal;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vProjPos;
    uniform sampler2D uFrontTexture; // depth texture of front face
    uniform sampler2D uBackTexture; // depth texture of back face
    uniform sampler2D uFrontTextureSecond; // depth texture of Second front face
    uniform sampler2D uBackTextureSecond; // depth texture of Second back face
    uniform sampler2D uFrontTextureThird; // depth texture of Third front face
    uniform sampler2D uBackTextureThird; // depth texture of Third back face
    uniform sampler2D uFrontTextureFourth; // depth texture of Fourth front face
    uniform sampler2D uBackTextureFourth; // depth texture of Fourth back face
    uniform vec3 uCameraPos; // camera position (can I use the built-in instead?)
    uniform vec2 uCameraSize; // size of orthographic camera viewport
    uniform float uCameraNear; // how close it captures (used for depth unpacking)
    uniform float uCameraFar; // how far it captures
    uniform float uCameraZoom; // zoom level
    uniform float uStepSize; // how far one step goes in the fixed-step marcher
    uniform float uCellSize; // size of one unit cell, not calibrated to any unit
    uniform vec3 uColor; // color of geometry
    uniform float uLightTheta; // theta angle of spherical light position
    uniform float uLightPhi; // phi angle of spherical light position
    uniform vec3 uLightCol; // color of light
    uniform int uGeoType; // type of geo infill (e.g. gyroid, octet, etc)
    uniform float uFillFactor; // thickness of infill, not calibrated to any unit (roughly 0 is empty and 1 is full)
    uniform bool uToggleDisplacement; // bool of whether to use noise surface textures or not
    uniform float uAdjustDisp; // how big the surface textures should be
    uniform int uDepthPeelVal; // how many steps of the depth peel should occur

    // Declare Parameters
    float ambiStrength = 0.4; // Ambient light strength
    float diffStength = 0.4; // Diffuse light strength
    float specStrength = 0.2; // Specular light strength
    float specPow = 4.0; // Specular light power (spread)
    float noiseSize = 8.0; // How big the noise should be scaled
    float noisePower = 0.01; // How much displacement in mm a value 1 noise reading should be
    float noiseSize2 = 2.0; // How big the noise should be scaled
    float noisePower2 = 0.5; // How much displacement in mm a value 1 noise reading should be


    // GEOMETRIES

    // Mesh SDF
    float distMesh(vec3 point, vec4 frontDepths, vec4 backDepths) {
        // todo
        return 0.0;
    }

    // Gyroid SDF
    float distGyroidBeam(vec3 point, float scale) {
        point *= scale;
        return (dot(sin(point), cos(point.zxy))) + (1.5-uFillFactor*3.0);
    }

    float distGyroidSurface(vec3 point, float scale) {
        point *= scale;
        return abs(dot(sin(point), cos(point.zxy))) - uFillFactor*1.5;
    }

    // Shwarz P SDF
    float distSchwarzP(vec3 point, float scale) {
        point *= scale;
        return abs(dot(vec3(1.), cos(point))) - uFillFactor*1.5;
    }

    // 3D repetition from HG_SDF https://mercury.sexy/hg_sdf/
    void pMod3(inout vec3 p, vec3 size) {
        p = mod(p + size*0.5, size) - size*0.5;
    }

    // Octet SDF
    float distBeam(vec3 point, vec3 normal, float radius) {
        return length(point - dot(point, normal) * normal) - radius;
    }

    float distOctet(vec3 position, float scale) {
        // Octect is made up of many beams, and is repeated in 3d domain
        float spacing = 10.0/scale;
        float beamRadius = uFillFactor*2.0;
        
        vec3 positionShiftXZ = position + vec3(spacing/2.0, 0.0, spacing/2.0);
        vec3 positionShiftXY = position + vec3(spacing/2.0, spacing/2.0, 0.0);
        
        pMod3( position, vec3(spacing));
        position.x = abs(position.x);
        position.y = abs(position.y);
        position.z = abs(position.z);
        if (position.y > position.x) { position.xy = position.yx; } 
        if (position.z > position.y) { position.yz = position.zy; } 
        
        float beamPlanar = distBeam(position, normalize(vec3(1.0,1.0,0.0)), beamRadius); 
        
        pMod3( positionShiftXZ, vec3(spacing));
        positionShiftXZ.x = abs(positionShiftXZ.x);
        positionShiftXZ.y = abs(positionShiftXZ.y);
        positionShiftXZ.z = abs(positionShiftXZ.z);
        if (positionShiftXZ.y > positionShiftXZ.x) { positionShiftXZ.xy = positionShiftXZ.yx; } 
        if (positionShiftXZ.z > positionShiftXZ.y) { positionShiftXZ.yz = positionShiftXZ.zy; } 

        float beamAngles = distBeam(positionShiftXZ, normalize(vec3(1.0,1.0,0.0)), beamRadius);
        
        pMod3( positionShiftXY, vec3(spacing));
        positionShiftXY = abs(positionShiftXY);
        float beamSection = distBeam(positionShiftXY, normalize(vec3(1.0,0.0,1.0)), beamRadius);
        
        return min(min(beamPlanar, beamAngles), beamSection);
    }

    // Select Geometry Type
    float distFill(vec3 position, float scale) {
        float dist;
        switch(uGeoType) {
            case 0:
                dist = distGyroidBeam(position, scale);
                break;
            case 1:
                dist = distGyroidSurface(position, scale);
                break;
            case 2:
                dist = distSchwarzP(position, scale);
                break;
            case 3:
                dist = distOctet(position, scale);
                break;
        }
        return dist;
    }

    // 3D Simplex Noise
    // From: https://www.shadertoy.com/view/XsX3zB

    /* discontinuous pseudorandom uniformly distributed in [-0.5, +0.5]^3 */
    vec3 random3(vec3 c) {
        float j = 4096.0*sin(dot(c,vec3(17.0, 59.4, 15.0)));
        vec3 r;
        r.z = fract(512.0*j);
        j *= .125;
        r.x = fract(512.0*j);
        j *= .125;
        r.y = fract(512.0*j);
        return r-0.5;
    }

    /* skew constants for 3d simplex functions */
    const float F3 =  0.3333333;
    const float G3 =  0.1666667;

    /* 3d simplex noise */
    float simplex3d(vec3 p) {
        /* 1. find current tetrahedron T and it's four vertices */
        /* s, s+i1, s+i2, s+1.0 - absolute skewed (integer) coordinates of T vertices */
        /* x, x1, x2, x3 - unskewed coordinates of p relative to each of T vertices*/
        
        /* calculate s and x */
        vec3 s = floor(p + dot(p, vec3(F3)));
        vec3 x = p - s + dot(s, vec3(G3));
        
        /* calculate i1 and i2 */
        vec3 e = step(vec3(0.0), x - x.yzx);
        vec3 i1 = e*(1.0 - e.zxy);
        vec3 i2 = 1.0 - e.zxy*(1.0 - e);
            
        /* x1, x2, x3 */
        vec3 x1 = x - i1 + G3;
        vec3 x2 = x - i2 + 2.0*G3;
        vec3 x3 = x - 1.0 + 3.0*G3;
        
        /* 2. find four surflets and store them in d */
        vec4 w, d;
        
        /* calculate surflet weights */
        w.x = dot(x, x);
        w.y = dot(x1, x1);
        w.z = dot(x2, x2);
        w.w = dot(x3, x3);
        
        /* w fades from 0.6 at the center of the surflet to 0.0 at the margin */
        w = max(0.6 - w, 0.0);
        
        /* calculate surflet components */
        d.x = dot(random3(s), x);
        d.y = dot(random3(s + i1), x1);
        d.z = dot(random3(s + i2), x2);
        d.w = dot(random3(s + 1.0), x3);
        
        /* multiply d by w^4 */
        w *= w;
        w *= w;
        d *= w;
        
        /* 3. return the sum of the four surflets */
        return dot(d, vec4(52.0));
    }
    // End of 3D Simplex Noise Segment

    // Fixed Step Ray Marcher
    float fixedStepMarcher(vec3 position, vec3 direction, vec4 frontDepths, vec4 backDepths, float scale) {
        float near = frontDepths.x;
        float far = backDepths.x;
        float dist = near;
        position += near * direction;
        int peel = 0;
        for (int iStep=0; iStep<MAX_STEPS; iStep++) {
            float distToGeo = distFill(position, scale);
            if (distToGeo > MIN_DIST && dist < MAX_DIST && dist < far) {
                position += uStepSize * direction;
                dist += uStepSize;
            } else if (dist >= far) {
                if (peel < 1) {
                    float bigStep = (frontDepths.y - far);
                    position += bigStep * direction;
                    dist += bigStep;
                    far = backDepths.y;
                    peel = 1;
                } else if (peel < 2) {
                    float bigStep = (frontDepths.z - far);
                    position += bigStep * direction;
                    dist += bigStep;
                    far = backDepths.z;
                    peel = 2;
                } else  if (peel < 3) {
                    float bigStep = (frontDepths.w - far);
                    position += bigStep * direction;
                    dist += bigStep;
                    far = backDepths.w;
                    peel = 3;
                } else{
                    return MAX_DIST;
                }
            } else {
                return dist;
            }
        }
        return 0.;
    }

    // Add Surface Noise for Bonus Texture
    float noiseDisplacement(vec3 position) {
        // Adds two frequencies of noise displacement to the surface
        float displacement1 = (noisePower/(1.5*uAdjustDisp)) * (1.0 - (2.0 * simplex3d(position * uAdjustDisp*noiseSize / uCellSize)));
        float displacement2 = (noisePower2/(1.5*uAdjustDisp)) * (1.0 - (2.0 * simplex3d(position * uAdjustDisp*noiseSize2 / uCellSize)));
        float totalDisplacement = displacement1 + displacement2;
        if (!uToggleDisplacement) {totalDisplacement = 0.0;}
        return totalDisplacement;
    }
    
    float distFillPlusNoiseDisp(vec3 position, float scale) {
        return distFill(position, scale) + noiseDisplacement(position);
    }

    // Gyroid Beam Gradient (For Normal)
    vec3 tpmsGradBeam(vec3 position, float scale) {
        vec3 change;
        change.x = (distFillPlusNoiseDisp( position + vec3(NORM_EPS, 0, 0), scale) - distFillPlusNoiseDisp( position - vec3(NORM_EPS, 0, 0), scale));
        change.y = (distFillPlusNoiseDisp( position + vec3(0, NORM_EPS, 0), scale) - distFillPlusNoiseDisp( position - vec3(0, NORM_EPS, 0), scale)); 
        change.z = (distFillPlusNoiseDisp( position + vec3(0, 0, NORM_EPS), scale) - distFillPlusNoiseDisp( position - vec3(0, 0, NORM_EPS), scale)); 
        return normalize( change );
    }

    // Camera Fragment Position (Orthographic)
    vec3 orthoFragPos(vec2 fragCoord, vec3 cameraDir, vec3 cameraPos) {

        // Ortho Pixel Pos Adj
        vec3 initialUp = vec3(0.0, 1.0, 0.0);
        if (cameraDir.x == 0.0 && cameraDir.z == 0.0 && cameraDir.y != 0.0) {
            initialUp = vec3(0.0, 0.0, 1.0);
        }
        vec2 uv = gl_FragCoord.xy/vec2(textureSize(uFrontTexture, 0));
        vec2 offset = (uv * uCameraSize / uCameraZoom) - (uCameraSize / uCameraZoom * 0.5);
        vec3 rightChange = normalize(cross(cameraDir, initialUp));
        vec3 upChange = normalize(cross(rightChange, cameraDir));
        vec3 worldOffset = offset.x * rightChange + offset.y * upChange;
        return cameraPos + worldOffset;
    }

    // RGBA Unpacking
    float unpackRGBAToDepth(vec4 color) {
        const vec4 bitShifts = vec4(1.0 / (256.0 * 256.0 * 256.0), 1.0 / (256.0 * 256.0), 1.0 / 256.0, 1.0);
        float depth = dot(color, bitShifts);
        return depth;
    }

    // MAIN
    void main() {

        // Determine Gyroid Geometry Scale
        float scale = 2.0*PI/uCellSize; // Geo scale

        // Find Front and Back Depth from Textures (First Peel)
        vec2 uv = gl_FragCoord.xy/vec2(textureSize(uFrontTexture, 0));

        float frontDepth = 1.0 - unpackRGBAToDepth(texture2D( uFrontTexture, uv));
        float backDepth = 1.0 - unpackRGBAToDepth(texture2D( uBackTexture, uv));

        // Find Subsequent Depth Peels and Pack into Vec4
        vec4 frontDepths = vec4(
            frontDepth, 
            texture2D( uFrontTextureSecond, uv).r,
            texture2D( uFrontTextureThird, uv).r,
            texture2D( uFrontTextureFourth, uv).r
        );
        frontDepths = uCameraNear + (1.0 - frontDepths) * uCameraFar;

        vec4 backDepths = vec4(
            backDepth, 
            texture2D( uBackTextureSecond, uv).r,
            texture2D( uBackTextureThird, uv).r,
            texture2D( uBackTextureFourth, uv).r
        );
        backDepths = uCameraNear + (1.0 - backDepths) * uCameraFar;

        // Restrict Depth Peel Steps (Debug and Educational Only)
        switch (uDepthPeelVal) {
            case 1:
                frontDepths = vec4(frontDepths.x, vec3(uCameraFar));
                backDepths = vec4(backDepths.x, vec3(uCameraFar));
                break;
            case 2:
                frontDepths = vec4(frontDepths.xy, vec2(uCameraFar));
                backDepths = vec4(backDepths.xy, vec2(uCameraFar));
                break;
            case 3:
                frontDepths = vec4(frontDepths.xyz, uCameraFar);
                backDepths = vec4(backDepths.xyz, uCameraFar);
                break;
        }

        // Find Camera Angle
        vec3 cameraDir = normalize(-uCameraPos);
        vec3 fragPos = orthoFragPos(gl_FragCoord.xy, cameraDir, uCameraPos);

        // Background is Black
        vec3 col = vec3(0.0);
        gl_FragColor = vec4(vec3(col), 0.0);

        // Ray March to Find Object Position (Fixed Step)
        float objDist = fixedStepMarcher(fragPos.xyz, cameraDir, frontDepths, backDepths, scale);
        vec3 objPos = fragPos + cameraDir * objDist;

        // If Object Solve Lighting
        if (objDist < MAX_DIST) {

            // Find Normal and Add Noise Displacement
            vec3 normal;
            if (objDist == frontDepths.x) {
                // Normal of Mesh Obj
                normal = vNormal;
            } else {
                // Normal of Gyroid
                normal = tpmsGradBeam(objPos, scale);

                // Add Noise Displacement
                objDist += noiseDisplacement(objPos); 
            }


            // Adjust Light Position
            float lRadius = 15.0;
            float lPhi = uLightPhi;
            float lTheta = uLightTheta;
            vec3 lightPos = vec3(lRadius*sin(lPhi)*cos(lTheta), lRadius*cos(lPhi), lRadius*sin(lPhi)*sin(lTheta));
            
            // Dist From Light
            float lightDist = length(lightPos-objPos);
            float cheapAO = min(1.0, 20.0/(lightDist)); 

            // Ambient Lighting
            vec3 ambiLight = vec3(1.) * ambiStrength;
            
            // Diffuse Lighting
            vec3 diffDir = normalize(lightPos - objPos);
            vec3 diffLight = uLightCol * diffStength * max(dot(normal, diffDir), 0.0);
            
            // Specular Lighting
            vec3 reflDir = reflect(-diffDir, normal);
            float specFact = pow(max(dot(-cameraDir, reflDir), 0.0), specPow);
            vec3 specLight = uLightCol * specStrength * specFact;
            
            // Phong Combined Lighting
            vec3 combLight = ambiLight + diffLight + specLight;

            // Mix It All Up!
            col = combLight * uColor * cheapAO;
            
            // Output Fragment
            gl_FragColor = vec4(vec3(col), 1.0);
        }
        
    }
`
// End Shader Section

// JS Globals
let scene, frontScene, backScene
let depthMeshFront, depthMeshBack
let depthMatFront, depthMatBack, depthPeelMat
let renderTargetsBack = [] 
let renderTargetsFront = []
let renderer, camera, controls, stats

// Calc Light Position
const lightPosition = (phi, theta) => {
    let radius = 15.0;
    return [
        radius*Math.sin(phi)*Math.cos(theta), 
        radius*Math.cos(phi),
        radius*Math.sin(phi)*Math.sin(theta)
    ]
}

// Setup
const init = () => {
    
    // Consts
    const dpmm = 25 // dots per mm
    const cameraNear = 0 // mm
    const cameraFar = 100 // mm
    
    // Window Params
    let width = window.innerWidth
    let height = window.innerHeight
    
    // Scene, Renderer, Controls
    scene = new THREE.Scene()
    camera = new THREE.OrthographicCamera(-width/(2*dpmm), width/(2*dpmm), height/(2*dpmm), -height/(2*dpmm), cameraNear, cameraFar)
    camera.position.set(25, 15, 20)
    scene.add(camera)

    renderer = new THREE.WebGLRenderer()
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.autoClear = false;
    document.body.appendChild(renderer.domElement)

    controls = new OrbitControls(camera, renderer.domElement)
    controls.mouseButtons.RIGHT = '' // disable pan

    // Background Texture
    scene.background = new THREE.Color( 0x000000 )
	scene.fog = new THREE.Fog( 0x000000, 25, 75 )
    const floorMaterial = new THREE.MeshBasicMaterial()
    floorMaterial.color = new THREE.Color(0x333333)
    const floorMesh = new THREE.Mesh( new THREE.PlaneGeometry( 500, 500 ), floorMaterial )
    floorMesh.rotation.x = - Math.PI / 2
    floorMesh.position.y = -15
    scene.add(floorMesh)


    // Render Targets and Secondary Scenes for Depths
    for (let i=0; i<4; i++) {
        renderTargetsFront.push(
            new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
            })
        )
        renderTargetsBack.push(
            new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
            })
        )
    }
    
    frontScene = new THREE.Scene()
    backScene = new THREE.Scene()

    // Model
    let meshConfigs = {
        'geometry': 'torusKnot',
        'lightColor': [1.0, 1.0, 1.0],
        'lightHue': 1.0
    }

    const Torus = (radius, tube, radSegs, tubeSegs) => {
        let newTorus = new THREE.TorusGeometry(radius, tube, radSegs, tubeSegs)
        newTorus.rotateX(Math.PI/2)
        return newTorus
    }

    const geometries = {
        box: new RoundedBoxGeometry(20, 20, 20, 10, 5),
        flatBox: new RoundedBoxGeometry(2, 20, 20, 10, 5),
        sphere: new THREE.SphereGeometry(10),
        cone: new THREE.ConeGeometry(10, 20),
        torus: Torus(10, 4, 16, 100),
        torusKnot: new THREE.TorusKnotGeometry(10, 5),
        teapot: new TeapotGeometry(10),
    }
    let geometry = geometries[meshConfigs.geometry]

    // Depth Renders
    // Front depth will track where the fragment hits the mesh (first time only)
    depthMatFront = new THREE.MeshDepthMaterial()
    depthMatFront.side = THREE.FrontSide
    depthMatFront.depthPacking = THREE.RGBADepthPacking 
    depthMeshFront = new THREE.Mesh(geometry, depthMatFront)
    frontScene.add(depthMeshFront)

    // Back depth will track where the fragment exits the mesh (first time only)
    depthMatBack = new THREE.MeshDepthMaterial()
    depthMatBack.side = THREE.BackSide
    depthMatBack.depthPacking = THREE.RGBADepthPacking
    depthMeshBack = new THREE.Mesh(geometry, depthMatBack)
    backScene.add(depthMeshBack)

    // Subsequent depth peel material (2nd through 4th peel)
    depthPeelMat = new THREE.ShaderMaterial({
        uniforms: {
            'uOutputRef': {'value': renderTargetsBack[0].texture },
        },
        vertexShader: vert,
        fragmentShader: fragDepth
    })

    // Shader Material & Mesh
    const shaderConfigs = {
        'stepSize': 0.02,
        'cellSize': 4,
        'lightTheta': Math.PI/4,
        'lightPhi': Math.PI/3,
        'color': [0.8,0.8,0.8],
        'geoType': 0,
        'fillFactor': 0.25,
        'toggleSurfaceNoise': true,
        'surfaceNoiseSize': 1.0,
        'depthPeelSteps': 4
    }
    const material = new THREE.ShaderMaterial({
        uniforms: {
            'uFrontTexture': { 'value': renderTargetsFront[0].texture },
            'uBackTexture': { 'value': renderTargetsBack[0].texture },
            'uFrontTextureSecond': { 'value': renderTargetsFront[1].texture },
            'uBackTextureSecond': { 'value': renderTargetsBack[1].texture },
            'uFrontTextureThird': { 'value': renderTargetsFront[2].texture },
            'uBackTextureThird': { 'value': renderTargetsBack[2].texture },
            'uFrontTextureFourth': { 'value': renderTargetsFront[3].texture },
            'uBackTextureFourth': { 'value': renderTargetsBack[3].texture },
            'uCameraPos': { 'value': camera.position },
            'uCameraSize': { 'value': new THREE.Vector2(width/dpmm, height/dpmm)},
            'uCameraNear': { 'value': cameraNear },
            'uCameraFar': { 'value': cameraFar },
            'uCameraZoom': { 'value': camera.zoom },
            'uStepSize': { 'value': shaderConfigs.stepSize },
            'uCellSize': { 'value': shaderConfigs.cellSize },
            'uColor': { 'value': shaderConfigs.color },
            'uLightTheta': { 'value': shaderConfigs.lightTheta },
            'uLightPhi': { 'value': shaderConfigs.lightPhi },
            'uLightCol': { 'value': meshConfigs.lightColor },
            'uGeoType': { 'value': shaderConfigs.geoType },
            'uFillFactor': { 'value': shaderConfigs.fillFactor },
            'uToggleDisplacement': { 'value': shaderConfigs.toggleSurfaceNoise },
            'uAdjustDisp': { 'value': shaderConfigs.surfaceNoiseSize },
            'uDepthPeelVal': { 'value': shaderConfigs.depthPeelSteps }
        },
        vertexShader: vert,
        fragmentShader: fragMain,
        transparent: true
    })
    console.log(material.uniforms)
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    // Light Object 
    // from https://github.com/mrdoob/three.js/blob/master/examples/webgl_lights_physical.html)
    const bulbGeometry = new THREE.SphereGeometry( 0.1, 16, 8 );
    const bulbLight = new THREE.PointLight( 0xffee88, 1, 100, 2 );

    const bulbMat = new THREE.MeshStandardMaterial( {
        emissive: 0xffffff,
        emissiveIntensity: 1,
        color: 0x000000
    } );
    console.log(bulbMat)
    bulbLight.add( new THREE.Mesh( bulbGeometry, bulbMat ) );
    bulbLight.castShadow = true;
    scene.add( bulbLight );

    // Adjust Light Position
    let lightPos = lightPosition(shaderConfigs.lightTheta)
    bulbLight.position.set(lightPos[0], lightPos[1], lightPos[2])

    // Controls Change Event Listener
    controls.addEventListener('change', () => {
        material.uniforms.uCameraPos.value = camera.position
        material.uniforms.uCameraZoom.value = camera.zoom
        updateRender()
    })

    // Window Resize Event Listener
    window.addEventListener(
        'resize',
        () => {
            width = window.innerWidth
            height = window.innerHeight
            camera.aspect = width/height
            camera.updateProjectionMatrix()
            material.uniforms.uCameraSize.value = new THREE.Vector2(width/dpmm, height/dpmm)
            groundMirror.getRenderTarget().setSize(
                window.innerWidth * window.devicePixelRatio,
                window.innerHeight * window.devicePixelRatio
            );
            renderer.setSize(width, height)
            updateRender()
        },
        false
    )

    // FPS Stats
    stats = Stats()
    document.body.appendChild(stats.dom)

    // UI and Handlers
    const gui = new GUI()
    const sceneFolder = gui.addFolder('Scene Configs')
    sceneFolder.add(meshConfigs, 'geometry', Object.keys(geometries)).onChange( value => {
        mesh.geometry = geometries[value]
        depthMeshBack.geometry = geometries[value]
        depthMeshFront.geometry = geometries[value]
        updateRender()
    })
    sceneFolder.add(meshConfigs, 'lightHue', 0.0, 1.0).onChange( value => {
        let color = new THREE.Color("hsl("+value*255+", 100%, 50%)")
        console.log(color)
        bulbMat.emissive = color
        let rgb = color.toArray();
        console.log(rgb)
        material.uniforms.uLightCol.value = rgb
        floorMaterial.color = new THREE.Color("hsl("+value*255+", 15%, 20%)")
        updateRender()
    })
    sceneFolder.add(shaderConfigs, 'lightTheta', 0, Math.PI*2).onChange( value => {
        material.uniforms.uLightTheta.value = value
        lightPos = lightPosition(shaderConfigs.lightPhi, value)
        bulbLight.position.set(lightPos[0], lightPos[1], lightPos[2])
        updateRender()
    })
    const shaderFolder = gui.addFolder('Shader Configs')
    shaderFolder.add(shaderConfigs, 'stepSize', 0.001, 0.1).onChange( value => { 
        material.uniforms.uStepSize.value = value 
        updateRender()
    })
    shaderFolder.add(shaderConfigs, 'cellSize', 0.5, 10).onChange( value => { 
        material.uniforms.uCellSize.value = value 
        updateRender()
    })
    shaderFolder.add(shaderConfigs, 'fillFactor', 0.1, 1).onChange( value => { 
        material.uniforms.uFillFactor.value = value 
        updateRender()
    })
    shaderFolder.add(shaderConfigs, 'geoType', {'gyroidBeam': 0, 'gyroidSurface': 1, 'schwarzP': 2, 'octet': 3}).onChange( value => { 
        material.uniforms.uGeoType.value = value 
        updateRender()
    })
    shaderFolder.add(shaderConfigs, 'toggleSurfaceNoise').onChange( value => {
        material.uniforms.uToggleDisplacement.value = value
        updateRender()
    })
    shaderFolder.add(shaderConfigs, 'surfaceNoiseSize', 0.1, 3.0).onChange( value => {
        material.uniforms.uAdjustDisp.value = value
        updateRender()
    })
    shaderFolder.add(shaderConfigs, 'depthPeelSteps', 1, 4, 1).onChange( value => {
        material.uniforms.uDepthPeelVal.value = value
        updateRender()
    })
    shaderFolder.addColor({color:shaderConfigs.color}, 'color').onChange( value => {
        material.uniforms.uColor.value = value
        updateRender()
    })
    


}

// Render wrapper
function updateRender() {
    render()
    render() // second render helps with stuttering due to multiple render pass, unsure why
    stats.update()
}

// Render one frame
function render() {
    
    // Render FRONT face depth peel target
    depthMeshFront.material = depthMatFront
    renderer.setRenderTarget(renderTargetsFront[0])
    renderer.clear()
    renderer.render(frontScene, camera)

    // Render BACK face depth peel target
    depthMeshBack.material = depthMatBack
    renderer.setRenderTarget(renderTargetsBack[0])
    renderer.clear()
    renderer.render(backScene, camera)


    // For subsequent depth peels, alternate front and back
    depthMeshFront.material = depthPeelMat
    depthMeshBack.material = depthPeelMat
    let gl = renderer.getContext() // get webGL context
    gl.enable(gl.CULL_FACE);

    for (let iPass=1; iPass<4; iPass++) {
        
        // Front pass
        depthPeelMat.uniforms.uOutputRef.value = renderTargetsBack[iPass-1].texture
        gl.cullFace(gl.BACK);
        renderer.setRenderTarget(renderTargetsFront[iPass])
        renderer.clear()
        renderer.render(frontScene, camera)
        
        // Back pass
        depthPeelMat.uniforms.uOutputRef.value = renderTargetsFront[iPass].texture
        gl.cullFace(gl.FRONT);
        renderer.setRenderTarget(renderTargetsBack[iPass])
        renderer.clear()
        renderer.render(backScene, camera)
    }

    // render scene
    gl.cullFace(gl.BACK);
    renderer.setRenderTarget(null)
    renderer.clear()
    renderer.render(scene, camera)
}

// Start!
init()
updateRender()
