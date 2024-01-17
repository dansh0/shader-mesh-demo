# Combined Mesh & SDF Shader Demo

<img src="https://github.com/dansh0/shader-mesh-demo/blob/main/media/Screenshot%202023-12-19%20094746.png" width="500px"/>


## Overview
Raymarching and SDFs are a great way to make highly efficient shapes and fills, but integrating them into a mesh scene is very difficult, since meshes don't convert to SDFs nicely or vice-versa.

This is a cheap way of combining them, by sampling the front (entrance) depth and back (exit) depth of the meshes in the scene, and then applying a triply-periodic infill or volumetric environment to these zones on a pixel-to-pixel basis using the fragment shader.

Here I use an example of TPMS structures (gyroids, schwarz-p) and beam structures (octet) to show how this can create good looking infills for fairly cheap. The marcher is fixed-step to allow for future plans of volumetric properties, but this approach works fine with a standard raymarcher as well.

To address the problem of entering and exiting meshes multiple times, I use a basic depth peeling algorithm, establishing entrance and exit depths for each pixel fragment up to four layers deep. This information is held in eight textures that must be rendered to as renderTargets before the main render step happens. More info on depth peeling: https://developer.download.nvidia.com/assets/gamedev/docs/OrderIndependentTransparency.pdf

## Live Demo
Run it live here:

https://shores.design/index.php/shader-mesh-demo/

(Should run fine with any decent computer, if it's laggy when rotating then increase the step count parameter)

## To Run

```
npm install
npm start
```

## Examples
<img src="https://github.com/dansh0/shader-mesh-demo/blob/main/media/Screenshot%202023-12-19%20094843.png" width="500px"/>

<img src="https://github.com/dansh0/shader-mesh-demo/blob/main/media/Screenshot%202023-12-19%20095000.png" width="500px"/>


## Project Context - The Problem

For a company I previously worked at, we had a 3d-printer slicing software that worked with meshes (STLs, etc as most all of them do). As a new feature we wanted the ability to add infills for lightweighting without strength loss, as well as control of a proprietary advanced materials property. Infills are expensive to generate and render as meshes, but easy to render as Implicit Models (such as SDFs for raymarched shaders). You can combine SDFs (signed distance fields) of boundary objects like spheres and cubes with SDFs of fills like gyroids or octects fairly easily, but there is little to be found with merging the implicit raymarching world of SDFs and the triangulated world of meshes. These environments are systematically separated by the CPU and GPU hardware divide.

**The Problem: Meshes and SDFs don't work well together, particularly the problem of defining a boundary of a surface mesh, and the infill pattern such as a gyroid or octet beams.** 

Gyroid Fill (with Cube)
<br><img src="https://github.com/dansh0/shader-mesh-demo/blob/main/media/gyroidFill.png" width="500px"/>

Gyroid Fill Zoomed In (2x2 unit cells)
<br><img src="https://github.com/dansh0/shader-mesh-demo/blob/main/media/gyroidZoomed.png" width="500px"/>

Solid Mesh of Teapot
<br><img src="https://github.com/dansh0/shader-mesh-demo/blob/main/media/SolidTeaPot.png" width="500px"/>

## Project Context - The Solution

In order to merge our mesh with the implicit infill, I extended our mesh scene with a custom shader material (in Three.JS) that contains information of a second scene, this time as a raymarched fragment shader (implicit). The key here was to set up the shader uniforms such that any change to the first scene was exactly updated to the second scene. Next, I set up the renderer to do multiple passes per render draw, with the first render passes writing to render targets that store depth information about the entry and exit points of the mesh from each pixel in the camera's perspective. This allows to know not only the depth of each fragment's first hit, but also the exit of that fragment hit from the mesh and multiple subsequent entrances and exits. This method is known as Depth Peeling and is described by a famous Nvidia paper using that name. 
Passing the textures of those render targets into the final draw render allows us to construct a cheap SDF of the mesh itself, without having to cheap all the millions of triangles of the mesh for each fragment. This representation can then be easily combined with other SDFs such as the gyroid fill described before in a standard raymarcher. The beauty of implicit geometry is also that you can render very fine repeating detail with no performance loss, such as millions of tiny unit cells.
This solution is efficient and effective for visual representation of the model on the screen for editing and previews to the user. For slicing itself, another method was employed using WebGL stencil buffers, but I cannot discuss that here.

**The Solution: Utilize Depth Peeling algorithms to create a cheap SDF of the mesh, which can then be used in a raymarching scene that is identical to the mesh scene.**

*Teapot With Gyroid Fill*
<br><img src="https://github.com/dansh0/shader-mesh-demo/blob/main/media/gyroidTeapot.png" width="500px"/><br>

*Thin Wall of Gyroid Beams (Shows exit of mesh is correct)*
<br><img src="https://github.com/dansh0/shader-mesh-demo/blob/main/media/FlatBoxInverseGyroid.png" width="500px"/><br>

*Sphere with Octet Fill*
<br><img src="https://github.com/dansh0/shader-mesh-demo/blob/main/media/SphereWithOctetFill.png" width="500px"/><br>

*Torus Knot With Fine Gyroid Fill (No performance loss)*
<br><img src="https://github.com/dansh0/shader-mesh-demo/blob/main/media/TorusKnotFineGyroid.png" width="500px"/><br>

