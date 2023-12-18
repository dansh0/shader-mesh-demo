import * as THREE from 'three'
import { OrbitControls } from './jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from './jsm/geometries/RoundedBoxGeometry.js'
import { Reflector } from './jsm/objects/Reflector.js';
import Stats from './jsm/libs/stats.module.js'
import { GUI } from './jsm/libs/lil-gui.module.min.js'

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

const frag = `
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
    uniform sampler2D uFrontTexture;
    uniform sampler2D uBackTexture;
    uniform vec3 uCameraPos;
    uniform vec2 uCameraSize;
    uniform float uCameraNear;
    uniform float uCameraFar;
    uniform float uCameraZoom;
    uniform float uStepSize;
    uniform float uCellSize;
    uniform vec3 uColor;
    uniform float uLightTheta;
    uniform float uLightPhi;
    uniform vec3 uLightCol;
    uniform int uGeoType;
    uniform float uFillFactor;

    // Declare Parameters
    float ambiStrength = 0.4; // Ambient light strength
    float diffStength = 0.4; // Diffuse light strength
    float specStrength = 0.2; // Specular light strength
    float specPow = 4.0; // Specular light power (spread)

    // GEOMETRIES

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

    // 3D repition from HG_SDF https://mercury.sexy/hg_sdf/
    void pMod3(inout vec3 p, vec3 size) {
        p = mod(p + size*0.5, size) - size*0.5;
    }

    // Octet SDF
    float distBeam(vec3 point, vec3 normal, float radius) {
        return length(point - dot(point, normal) * normal) - radius;
    }

    float distOctet(vec3 position, float scale) {
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

    // Fixed Step Ray Marcher
    float fixedStepMarcher(vec3 position, vec3 direction, float near, float far, float scale) {
        float dist = near;
        position += near * direction;
        for (int iStep=0; iStep<MAX_STEPS; iStep++) {
            float distToGeo = distFill(position, scale);
            if (distToGeo > MIN_DIST && dist < MAX_DIST && dist < far) {
                position += uStepSize * direction;
                dist += uStepSize;
            } else {
                return dist;
            }
        }
        return 0.;
    }

    // Gyroid Beam Gradient (For Normal)
    vec3 tpmsGradBeam(vec3 position, float scale) {
        vec3 change;
        change.x = (distFill( position + vec3(NORM_EPS, 0, 0), scale) - distFill( position - vec3(NORM_EPS, 0, 0), scale));
        change.y = (distFill( position + vec3(0, NORM_EPS, 0), scale) - distFill( position - vec3(0, NORM_EPS, 0), scale)); 
        change.z = (distFill( position + vec3(0, 0, NORM_EPS), scale) - distFill( position - vec3(0, 0, NORM_EPS), scale)); 
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
        const vec4 bitShifts = vec4(1.0 / (256.0 * 256.0 * 256.0), 1.0 / (256.0 * 256.0), 1.0 / 256.0, 1.0);        float depth = dot(color, bitShifts);
        return depth;
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

    void main() {

        // Determine Gyroid Geometry Scale
        float scale = 2.0*PI/uCellSize; // Geo scale

        // Find Front and Back Depth from Textures
        vec2 uv = gl_FragCoord.xy/vec2(textureSize(uFrontTexture, 0));

        float frontDepth = unpackRGBAToDepth(texture2D( uFrontTexture, uv));
        frontDepth = uCameraNear + (frontDepth)*uCameraFar;

        float backDepth = unpackRGBAToDepth(texture2D( uBackTexture, uv));
        backDepth = uCameraNear + (backDepth)*uCameraFar;
        
        // Find Camera Angle
        vec3 cameraDir = normalize(-uCameraPos);
        vec3 fragPos = orthoFragPos(gl_FragCoord.xy, cameraDir, uCameraPos);

        // Background is Black
        vec3 col = vec3(0.0);

        // Ray March to Find Object Position (Fixed Step)
        float objDist = fixedStepMarcher(fragPos.xyz, cameraDir, frontDepth, backDepth, scale);
        vec3 objPos = fragPos + cameraDir * objDist;

        // If Object Solve Lighting
        if (objDist < MAX_DIST && objDist < backDepth) {

            // Find Normal
            vec3 normal;
            if (objDist == frontDepth) {
                // Normal of Mesh Obj
                normal = vNormal;
            } else {
                // Normal of Gyroid
                normal = tpmsGradBeam(objPos, scale);
            }

            // Noise
            vec3 longPos = vec3(objPos.x, objPos.y*2.0, objPos.z);
            float noiseLarge = 1.0 - 0.3*simplex3d(objPos*0.1);
            float noiseSmall = 1.0 - 0.2*simplex3d(longPos*0.25);


            // Adjust Light Position
            float lRadius = 15.0;
            float lPhi = uLightPhi;
            float lTheta = uLightTheta;
            vec3 lightPos = vec3(lRadius*sin(lPhi)*cos(lTheta), lRadius*cos(lPhi), lRadius*sin(lPhi)*sin(lTheta));
            
            // Dist From Light
            float lightDist = length(lightPos-objPos);
            float cheapAO = min(1.0, 10.0/(lightDist)); 

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
            col = combLight * uColor * noiseLarge * noiseSmall * cheapAO;
            
        }
        
        // Output Fragment
        gl_FragColor = vec4(vec3(col), 1.0);
    }
`

// JS Globals
let scene, frontScene, backScene
let renderTargetBack, renderTargetFront
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
const Init = () => {
    
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

    // Render Targets and Secondary Scenes
    renderTargetFront = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
    })
    renderTargetBack = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
    })
    frontScene = new THREE.Scene()
    backScene = new THREE.Scene()

    // Model
    let meshConfigs = {
        'geometry': 'box',
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
        torus: Torus(10, 4, 16, 100),
    }
    let geometry = geometries[meshConfigs.geometry]

    // Depth Renders
    // Front depth will track where the fragment hits the mesh (first time only)
    const depthMatFront = new THREE.MeshDepthMaterial()
    depthMatFront.side = THREE.FrontSide
    depthMatFront.depthPacking = THREE.RGBADepthPacking // better, but needs to be unpacked in shader
    const depthMeshFront = new THREE.Mesh(geometry, depthMatFront)
    frontScene.add(depthMeshFront)

    // Back depth will track where the fragment exits the mesh (first time only)
    const depthMatBack = new THREE.MeshDepthMaterial()
    depthMatBack.side = THREE.BackSide
    depthMatBack.depthPacking = THREE.RGBADepthPacking
    const depthMeshBack = new THREE.Mesh(geometry, depthMatBack)
    backScene.add(depthMeshBack)

    // Shader Material & Mesh
    const shaderConfigs = {
        'stepSize': 0.02,
        'cellSize': 4,
        'lightTheta': Math.PI/4,
        'lightPhi': Math.PI/3,
        'color': [0.8,0.8,0.8],
        'geoType': 0,
        'fillFactor': 0.25
    }
    const material = new THREE.ShaderMaterial({
        uniforms: {
            'uFrontTexture': { 'value': renderTargetFront.texture },
            'uBackTexture': { 'value': renderTargetBack.texture },
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
            'uFillFactor': { 'value': shaderConfigs.fillFactor }
        },
        vertexShader: vert,
        fragmentShader: frag
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
        animate()
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
            render()
        },
        false
    )

    // FPS Stats
    stats = Stats()
    document.body.appendChild(stats.dom)

    // UI
    const gui = new GUI()
    const sceneFolder = gui.addFolder('Scene Configs')
    sceneFolder.add(meshConfigs, 'geometry', Object.keys(geometries)).onChange( value => {
        mesh.geometry = geometries[value]
        depthMeshBack.geometry = geometries[value]
        depthMeshFront.geometry = geometries[value]
        animate()
    })
    sceneFolder.add(meshConfigs, 'lightHue', 0.0, 1.0).onChange( value => {
        let color = new THREE.Color("hsl("+value*255+", 100%, 50%)")
        console.log(color)
        bulbMat.emissive = color
        let rgb = color.toArray();
        console.log(rgb)
        material.uniforms.uLightCol.value = rgb
        animate()
    })
    sceneFolder.add(shaderConfigs, 'lightTheta', 0, Math.PI*2).onChange( value => {
        material.uniforms.uLightTheta.value = value
        lightPos = lightPosition(shaderConfigs.lightPhi, value)
        bulbLight.position.set(lightPos[0], lightPos[1], lightPos[2])
        animate()
    })
    // sceneFolder.add(shaderConfigs, 'lightPhi', 0, Math.PI).onChange( value => {
    //     material.uniforms.uLightPhi.value = value
    //     lightPos = lightPosition(value, shaderConfigs.lightTheta)
    //     bulbLight.position.set(lightPos[0], lightPos[1], lightPos[2])
    //     animate()
    // })
    const shaderFolder = gui.addFolder('Shader Configs')
    shaderFolder.add(shaderConfigs, 'stepSize', 0.001, 0.1).onChange( value => { 
        material.uniforms.uStepSize.value = value 
        animate()
    })
    shaderFolder.add(shaderConfigs, 'cellSize', 0.5, 10).onChange( value => { 
        material.uniforms.uCellSize.value = value 
        animate()
    })
    shaderFolder.add(shaderConfigs, 'fillFactor', 0.1, 1).onChange( value => { 
        material.uniforms.uFillFactor.value = value 
        animate()
    })
    shaderFolder.add(shaderConfigs, 'geoType', {'gyroidBeam': 0, 'gyroidSurface': 1, 'schwarzP': 2, 'octet': 3}).onChange( value => { 
        material.uniforms.uGeoType.value = value 
        animate()
    })
    shaderFolder.addColor({color:shaderConfigs.color}, 'color').onChange( value => {
        material.uniforms.uColor.value = value
        animate()
    })


}

// Cycle Animation
function animate() {
    // requestAnimationFrame(animate)
    // controls.update()
    render()
    render()
    stats.update()
}

// Render one frame
function render() {
    
    // render targets
    renderer.setRenderTarget(renderTargetFront)
    renderer.clear()
    renderer.render(frontScene, camera)

    renderer.setRenderTarget(renderTargetBack)
    renderer.clear()
    renderer.render(backScene, camera)

    // render scene
    renderer.setRenderTarget(null)
    renderer.clear()
    renderer.render(scene, camera)
}

// Start!
Init()
animate()
