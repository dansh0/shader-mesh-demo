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
    #define MAX_STEPS 100000
    #define MAX_DIST 200.
    #define MIN_DIST 0.001
    #define DOTS_PER_MM 25.
    #define NORM_EPS 0.001
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

    // PARAMS
    float scale = 2.0; // Geo scale
    vec3 objCol = vec3(1.0, 1.0, 1.0); // Base material color
    vec3 lightCol = vec3(1.0, 1.0, 1.0); // Light color
    vec3 lightPos = vec3(50.); // Light source position
    float ambiStrength = 0.4; // Ambient light strength
    float diffStength = 0.4; // Diffuse light strength
    float specStrength = 0.2; // Specular light strength
    float specPow = 4.0; // Specular light power (spread)
    float gyroidFactor = 0.6; // Factor for shape of gyroid

    // GEOMETRY

    // Gyroid Beam
    float distGyroidBeam(vec3 point, float gyroidFactor) {
        point *= scale;
        return (dot(sin(point), cos(point.zxy))) + gyroidFactor;
    }


    // GEOMETRY COMBINATIONS

    // Distance Function Combine
    float distCombine( vec3 position ) {
        
        // geometry
        
        float beamDist = distGyroidBeam( position, gyroidFactor);
        return beamDist / uCameraZoom;
    }     

        
    // RAY TOOLS

    // Ray March
    float marcher(vec3 position, vec3 direction, float near, float far) {
        float dist = near;
        position += near * direction;
        for (int iStep=0; iStep<MAX_STEPS; iStep++) {
            float safeMarchDist = distCombine(position);
            if (safeMarchDist > MIN_DIST && dist < MAX_DIST && dist < far) {
                position += safeMarchDist * direction;
                dist += safeMarchDist;
            } else {
                return dist;
            }
        }
        return 0.;
    }

    // Normal Test
    vec3 marchNormal(vec3 position, vec3 direction, float near, float far) {
        float xChange = marcher(position + vec3(NORM_EPS, 0, 0), direction, near, far) - marcher(position - vec3(NORM_EPS, 0, 0), direction, near, far);
        float yChange = marcher(position + vec3(0, NORM_EPS, 0), direction, near, far) - marcher(position - vec3(0, NORM_EPS, 0), direction, near, far);
        float zChange = marcher(position + vec3(0, 0, NORM_EPS), direction, near, far) - marcher(position - vec3(0, 0, NORM_EPS), direction, near, far);
        return normalize( vec3(xChange, yChange, zChange) );
    }

    // tpmsGradient instead of normal (maybe the same??)
    vec3 tpmsGradBeam(vec3 position, float gyroidFactor) {
        vec3 change;
        change.x = (distGyroidBeam( position + vec3(NORM_EPS, 0, 0), gyroidFactor) - distGyroidBeam( position - vec3(NORM_EPS, 0, 0), gyroidFactor));
        change.y = (distGyroidBeam( position + vec3(0, NORM_EPS, 0), gyroidFactor) - distGyroidBeam( position - vec3(0, NORM_EPS, 0), gyroidFactor)); 
        change.z = (distGyroidBeam( position + vec3(0, 0, NORM_EPS), gyroidFactor) - distGyroidBeam( position - vec3(0, 0, NORM_EPS), gyroidFactor)); 
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

    // RGBA unpacking
    float unpackRGBAToDepth(vec4 color) {
  const vec4 bitShifts = vec4(1.0 / (256.0 * 256.0 * 256.0), 1.0 / (256.0 * 256.0), 1.0 / 256.0, 1.0);        float depth = dot(color, bitShifts);
        return depth;
    }

    void main() {

        vec2 uv = gl_FragCoord.xy/vec2(textureSize(uFrontTexture, 0));
        
        // float frontDepth = texture2D( uFrontTexture, uv).r;
        float frontDepth = unpackRGBAToDepth(texture2D( uFrontTexture, uv));
        frontDepth = uCameraNear + (frontDepth)*uCameraFar;

        // float backDepth = texture2D( uBackTexture, uv).r;
        float backDepth = unpackRGBAToDepth(texture2D( uBackTexture, uv));
        backDepth = uCameraNear + (backDepth)*uCameraFar;
        // TODO Depth Packing
        
        // adjust camera position and direction
        vec3 cameraDir = normalize(-uCameraPos);
        vec3 fragPos = orthoFragPos(gl_FragCoord.xy, cameraDir, uCameraPos);

        vec3 col = vec3(0.0);

        // Ray March
        float objDist = marcher(fragPos.xyz, cameraDir, frontDepth, backDepth);
        vec3 objPos = fragPos + cameraDir * objDist;
        
        if (objDist < MAX_DIST && objDist < backDepth) {

            // Find Normal
            vec3 normal;
            if (objDist == frontDepth) {
                // normal of mesh obj
                normal = vNormal;
            } else if (distGyroidBeam(objPos, gyroidFactor) < MIN_DIST) {
                // normal of gyroid
                // normal = tpmsGradBeam(fragPos.xyz, gyroidFactor);
                normal = marchNormal(fragPos.xyz, cameraDir, frontDepth, backDepth);
            } else {
                // normal of other SDF
                normal = marchNormal(fragPos.xyz, cameraDir, frontDepth, backDepth);
            }
            // col = vec3(normal);

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
        
        // col = vec3(backDepth/100.);
        gl_FragColor = vec4(vec3(col), 1.0);
    }
`

// Globals
let scene, frontScene, backScene
let renderTargetBack, renderTargetFront
let renderer, camera, controls, stats

// Setup
const Init = () => {
    
    // Consts
    const dpmm = 25
    const cameraNear = 0
    const cameraFar = 100
    
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
    requestAnimationFrame(animate)
    controls.update()
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
