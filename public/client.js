import * as THREE from 'three'
import { OrbitControls } from './jsm/controls/OrbitControls.js'
import { RoundedBoxGeometry } from './jsm/geometries/RoundedBoxGeometry.js'
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
    #define STEP_SIZE 0.02
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

    // Declare Parameters
    float scale = 2.0; // Geo scale
    vec3 objCol = vec3(1.0, 1.0, 1.0); // Base material color
    vec3 lightCol = vec3(1.0, 1.0, 1.0); // Light color
    vec3 lightPos = vec3(50.); // Light source position
    float ambiStrength = 0.4; // Ambient light strength
    float diffStength = 0.4; // Diffuse light strength
    float specStrength = 0.2; // Specular light strength
    float specPow = 4.0; // Specular light power (spread)
    float gyroidFactor = 0.8; // Factor for shape of gyroid

    // Gyroid SDF
    float distGyroidBeam(vec3 point) {
        point *= scale;
        return (dot(sin(point), cos(point.zxy))) + gyroidFactor;
    }

    // Fixed Step Ray Marcher
    float fixedStepMarcher(vec3 position, vec3 direction, float near, float far) {
        float dist = near;
        position += near * direction;
        for (int iStep=0; iStep<MAX_STEPS; iStep++) {
            float distToGeo = distGyroidBeam(position);
            if (distToGeo > MIN_DIST && dist < MAX_DIST && dist < far) {
                position += STEP_SIZE * direction;
                dist += STEP_SIZE;
            } else {
                return dist;
            }
        }
        return 0.;
    }

    // Gyroid Beam Gradient (For Normal)
    vec3 tpmsGradBeam(vec3 position, float gyroidFactor) {
        vec3 change;
        change.x = (distGyroidBeam( position + vec3(NORM_EPS, 0, 0)) - distGyroidBeam( position - vec3(NORM_EPS, 0, 0)));
        change.y = (distGyroidBeam( position + vec3(0, NORM_EPS, 0)) - distGyroidBeam( position - vec3(0, NORM_EPS, 0))); 
        change.z = (distGyroidBeam( position + vec3(0, 0, NORM_EPS)) - distGyroidBeam( position - vec3(0, 0, NORM_EPS))); 
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

    void main() {

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
        float objDist = fixedStepMarcher(fragPos.xyz, cameraDir, frontDepth, backDepth);
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
                normal = tpmsGradBeam(objPos, gyroidFactor);
            }

            // Ambient Lighting
            vec3 ambiLight = lightCol * ambiStrength;
            
            // Diffuse Lighting
            vec3 diffDir = normalize(lightPos - objPos);
            vec3 diffLight = lightCol * diffStength * max(dot(normal, diffDir), 0.0);
            
            // Specular Lighting
            vec3 reflDir = reflect(-diffDir, normal);
            float specFact = pow(max(dot(-cameraDir, reflDir), 0.0), specPow);
            vec3 specLight = lightCol * specStrength * specFact;
            
            // Phong Combined Lighting
            vec3 combLight = ambiLight + diffLight + specLight;
            col = combLight * objCol;
            
        }
        
        // Output Fragment
        gl_FragColor = vec4(vec3(col), 1.0);
    }
`

// JS Globals
let scene, frontScene, backScene
let renderTargetBack, renderTargetFront
let renderer, camera, controls, stats

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
    camera.position.set(20, 20, 20)
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
    const geometry = new RoundedBoxGeometry(20, 20, 20, 10, 5)

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
    const material = new THREE.ShaderMaterial({
        uniforms: {
            'uFrontTexture': { 'value': renderTargetFront.texture },
            'uBackTexture': { 'value': renderTargetBack.texture },
            'uCameraPos': { 'value': camera.position },
            'uCameraSize': { 'value': new THREE.Vector2(width/dpmm, height/dpmm)},
            'uCameraNear': { 'value': cameraNear },
            'uCameraFar': { 'value': cameraFar },
            'uCameraZoom': { 'value': camera.zoom }
        },
        vertexShader: vert,
        fragmentShader: frag
    })
    console.log(material.uniforms)
    const cube = new THREE.Mesh(geometry, material)
    scene.add(cube)

    // Controls Change Event Listener
    controls.addEventListener('change', ()=>{
        console.log(controls)
        console.log(camera)
        material.uniforms.uCameraPos.value = camera.position
        material.uniforms.uCameraZoom.value = camera.zoom
        console.log(material.uniforms)
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
            renderer.setSize(width, height)
            render()
        },
        false
    )

    // FPS Stats
    stats = Stats()
    document.body.appendChild(stats.dom)

    // UI
    // const gui = new GUI()
    // const cubeFolder = gui.addFolder('Cube')
    // cubeFolder.add(cube.scale, 'x', -5, 5)
    // cubeFolder.add(cube.scale, 'y', -5, 5)
    // cubeFolder.add(cube.scale, 'z', -5, 5)

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
// setTimeout(render, 100)
