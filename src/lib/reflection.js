/**
 * 平面反射:从"镜像相机"把场景再渲一遍到半分辨率 target,水面着色器按世界坐标投影取样。
 * 也就是 three 的 Reflector 那套做法(池塘项目的 src/reflection.js 已验证过)。
 *
 * 与池塘版的差别:这里主相机是**正交**的,镜像相机要复制 left/right/top/bottom/zoom;
 * 反射平面是任意 y = planeY(湖泊水面),不是 y=0。
 */
import * as THREE from 'three';

const BIAS = new THREE.Matrix4().set(
  0.5, 0.0, 0.0, 0.5,
  0.0, 0.5, 0.0, 0.5,
  0.0, 0.0, 0.5, 0.5,
  0.0, 0.0, 0.0, 1.0,
);

export function createReflection({ scene, planeY = 0, scale = 0.5 }) {
  const target = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  target.texture.wrapS = THREE.ClampToEdgeWrapping;
  target.texture.wrapT = THREE.ClampToEdgeWrapping;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 700);
  const persp = new THREE.PerspectiveCamera(60, 1, 0.01, 700);
  const textureMatrix = new THREE.Matrix4();
  const forward = new THREE.Vector3();
  const hideList = [];
  // 镜像相机在水面下方,会把水面以下的一切(岩底、湖床)渲进来并挡在最前面。
  // 必须裁掉 y < planeY 的部分,反射里才只剩"水面以上的世界"。
  // ⚠ 关键:three 的 program 缓存键里含"裁剪面数量"。
  // 每帧 0→1→0 切换,等于每帧把所有材质重编译两遍 —— 软件光栅只是慢,真显卡会卡死/黑屏。
  // 所以这里**恒定挂 1 个平面**,开关靠改 constant(它是 uniform,不触发重编译)。
  const FAR = 1e5;
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), FAR);

  function resize(width, height) {
    target.setSize(
      Math.max(2, Math.floor(width * scale)),
      Math.max(2, Math.floor(height * scale)),
    );
  }

  function render(renderer, main) {
    // 主相机可能是透视(仙人视角),镜像相机要跟着换类型
    const cam = main.isPerspectiveCamera ? persp : camera;
    main.getWorldDirection(forward);

    // 关于 y = planeY 做镜像:位置与 up 的 y 分量取反,朝向的 y 分量取反
    cam.position.set(main.position.x, 2 * planeY - main.position.y, main.position.z);
    cam.up.set(0, -1, 0);
    cam.lookAt(
      cam.position.x + forward.x,
      cam.position.y - forward.y,
      cam.position.z + forward.z,
    );
    if (main.isOrthographicCamera) {
      cam.left = main.left; cam.right = main.right;
      cam.top = main.top; cam.bottom = main.bottom;
      cam.zoom = main.zoom;
    } else {
      cam.fov = main.fov;
      cam.aspect = main.aspect;
    }
    cam.near = main.near;
    cam.far = main.far;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    textureMatrix.copy(BIAS).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    const prev = hideList.map((o) => [o, o.visible]);
    for (const o of hideList) o.visible = false;

    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    clipPlane.constant = -planeY;      // 这一遍:只保留 y > 水面
    // 反射用上一帧的阴影贴图就够(太阳动得很慢),省一遍 shadow pass
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
    clipPlane.constant = FAR;          // 主渲染:推到无穷远 = 不裁剪

    for (const [o, v] of prev) o.visible = v;
  }

  return {
    target,
    textureMatrix,
    resize,
    render,
    /** 只需要在启动时装一次:之后裁剪面数量永远不变 */
    install(renderer) {
      renderer.clippingPlanes = [clipPlane];
    },
    exclude(obj) { hideList.push(obj); },
  };
}
