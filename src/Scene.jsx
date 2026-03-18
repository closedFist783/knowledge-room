import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Text, RoundedBox } from '@react-three/drei'
import { useRef, useState, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useStore } from './store'
import * as THREE from 'three'

// ── WORLD LAYOUT: fixed positions around origin ──
// Each depth = a regular polygon ring in XZ, staggered per ring so no sight-line overlap
function computeWorldLayout(nodes, visibleIds) {
  const result = {}
  if (!nodes.length) return result

  const visSet = visibleIds && visibleIds.length > 0 ? new Set(visibleIds) : null

  const childrenOf = {}
  nodes.forEach(n => { childrenOf[n.id] = n.children || [] })

  // BFS depth
  const depthMap = {}
  const root = nodes[0]
  const queue = [root.id]; depthMap[root.id] = 0
  const visited = new Set([root.id])
  while (queue.length) {
    const id = queue.shift()
    ;(childrenOf[id] || []).forEach(cid => {
      if (!visited.has(cid)) { visited.add(cid); depthMap[cid] = (depthMap[id] || 0) + 1; queue.push(cid) }
    })
  }
  nodes.forEach(n => { if (depthMap[n.id] === undefined) depthMap[n.id] = 1 })

  // Group visible nodes by depth
  const byDepth = {}
  nodes.forEach(n => {
    if (visSet && !visSet.has(n.id)) return
    const d = Math.min(depthMap[n.id] || 0, 5)
    if (!byDepth[d]) byDepth[d] = []
    byDepth[d].push(n.id)
  })

  Object.entries(byDepth).forEach(([dStr, ids]) => {
    const d = parseInt(dStr)
    const n = ids.length

    if (d === 0) {
      // Root: placed directly in front of where camera starts
      result[ids[0]] = new THREE.Vector3(0, 0, -5)
      return
    }

    const radius = 5 + d * 4
    const y      = -d * 2.2
    // Stagger each ring so they don't line up with the previous
    const startAngle = d * 0.61 // golden-ratio-ish offset so rings never align

    ids.forEach((id, i) => {
      const angle = startAngle + (i / n) * Math.PI * 2
      result[id] = new THREE.Vector3(
        Math.sin(angle) * radius,
        y,
        -Math.cos(angle) * radius
      )
    })
  })

  // Hidden nodes: park underground, out of view
  nodes.forEach(n => {
    if (!result[n.id]) result[n.id] = new THREE.Vector3(0, -80, 0)
  })

  return result
}

// ── NODE: fixed world position, billboards toward camera ──
function NodeMesh({ node, worldPos, isActive, targetOpacity }) {
  const groupRef     = useRef()
  const bgMatRef     = useRef()
  const borderMatRef = useRef()
  const glowMatRef   = useRef()
  const opacityRef   = useRef(0)
  const currentPos   = useRef(worldPos.clone())
  const [textOpacity, setTextOpacity] = useState(0)
  const bobTime      = useRef(Math.random() * Math.PI * 2)

  const isRoot    = node.type === 'root'
  const isSection = node.type === 'section'
  const w = isRoot ? 2.8 : isSection ? 2.2 : 1.75
  const h = isRoot ? 0.72 : 0.52
  const fontSize = isRoot ? 0.162 : isSection ? 0.132 : 0.112

  useFrame((state, delta) => {
    if (!groupRef.current) return
    bobTime.current += delta

    // Lerp toward target world position (handles show/hide transitions)
    currentPos.current.lerp(worldPos, 0.08)

    const bobY = isActive
      ? currentPos.current.y + 0.14 + Math.sin(bobTime.current * 2.4) * 0.08
      : currentPos.current.y
    groupRef.current.position.set(currentPos.current.x, bobY, currentPos.current.z)

    // Billboard: always face camera
    groupRef.current.lookAt(state.camera.position)

    // Opacity
    opacityRef.current += (targetOpacity - opacityRef.current) * 0.07
    const op = opacityRef.current
    if (bgMatRef.current)     bgMatRef.current.opacity     = op
    if (borderMatRef.current) borderMatRef.current.opacity = op * (isActive ? 0.95 : isRoot ? 0.65 : 0.4)
    if (glowMatRef.current)   glowMatRef.current.opacity   = op * 0.13
    if (Math.abs(op - textOpacity) > 0.025) setTextOpacity(op)

    // Scale pulse
    const ts = isActive ? 1.07 : 1.0
    groupRef.current.scale.setScalar(
      groupRef.current.scale.x + (ts - groupRef.current.scale.x) * 0.1
    )
  })

  return (
    <group ref={groupRef}>
      <mesh position={[0, 0, -0.06]} renderOrder={0}>
        <planeGeometry args={[w + 1.2, h + 0.9]} />
        <meshBasicMaterial ref={glowMatRef} color="#dde8ff" transparent opacity={0} depthWrite={false} />
      </mesh>
      <RoundedBox args={[w + 0.06, h + 0.06, 0.005]} radius={0.14} smoothness={4} position={[0, 0, -0.008]} renderOrder={1}>
        <meshBasicMaterial ref={borderMatRef} color={isActive ? '#000' : isRoot ? '#333' : '#777'} transparent opacity={0} depthWrite={false} />
      </RoundedBox>
      <RoundedBox args={[w, h, 0.01]} radius={0.12} smoothness={4} renderOrder={2}>
        <meshBasicMaterial ref={bgMatRef} color={isActive ? '#f8f8f8' : '#ffffff'} transparent opacity={0} depthWrite={false} />
      </RoundedBox>
      <Text
        position={[0, 0, 0.022]} renderOrder={3}
        font="/fonts/CormorantGaramond-Regular.ttf"
        fontSize={fontSize} color="#111111"
        anchorX="center" anchorY="middle"
        maxWidth={w - 0.28} lineHeight={1.35}
        fillOpacity={textOpacity}
      >
        {node.label}
      </Text>
    </group>
  )
}

// ── EDGE: draws between live node positions ──
function EdgeLine({ fromId, toId, targetOpacity, livePositions }) {
  const lineRef    = useRef()
  const opacityRef = useRef(0)
  const geoRef     = useRef(new THREE.BufferGeometry())

  useFrame(() => {
    if (!lineRef.current) return
    const a = livePositions.current[fromId]
    const b = livePositions.current[toId]
    if (a && b) {
      const mid = a.clone().lerp(b, 0.5); mid.y += 0.7
      geoRef.current.setFromPoints(
        new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(20)
      )
    }
    opacityRef.current += (targetOpacity * 0.28 - opacityRef.current) * 0.07
    lineRef.current.material.opacity = opacityRef.current
  })

  return (
    <line ref={lineRef} geometry={geoRef.current} renderOrder={0}>
      <lineBasicMaterial color="#aaa" transparent opacity={0} depthWrite={false} />
    </line>
  )
}

// ── LIVE POSITION TRACKER: reads node mesh positions for edges ──
function PositionTracker({ nodeId, livePositions }) {
  const ref = useRef()
  // Each tracker is a tiny invisible mesh co-located with the node
  // We track via the NodeMesh's currentPos by sharing a ref instead
  return null // handled inline in NodeMesh via livePositions
}

// ── SCENE CONTENT ──
const SceneContent = forwardRef(function SceneContent(_, ref) {
  const nodes        = useStore(s => s.nodes)
  const edges        = useStore(s => s.edges)
  const activeNodeId = useStore(s => s.activeNodeId)
  const visibleIds   = useStore(s => s.visibleNodeIds)

  const { camera, gl } = useThree()
  const keys            = useRef({})
  const yaw             = useRef(0)
  const pitch           = useRef(0)
  const isPointerLocked = useRef(false)
  const userMoving      = useRef(false)
  const moveTimer       = useRef(null)
  const prevNodeCount   = useRef(0)
  const focusRef        = useRef(null) // { worldPos, endTime }
  // Shared live positions for edge drawing
  const livePositions   = useRef({})

  const worldLayout = useMemo(
    () => computeWorldLayout(nodes, visibleIds),
    [nodes, visibleIds]
  )

  // Expose to App
  useImperativeHandle(ref, () => ({
    getFrontNodeLabel: () => {
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd)
      let best = null, bestDot = 0.65
      nodes.forEach(n => {
        const wp = worldLayout[n.id]
        if (!wp) return
        const dir = wp.clone().sub(camera.position).normalize()
        const dot = dir.dot(fwd)
        if (dot > bestDot) { bestDot = dot; best = n }
      })
      return best?.label || null
    },
    getVisibleLabels: () => {
      const vis = (!visibleIds || visibleIds.length === 0) ? nodes : nodes.filter(n => visibleIds.includes(n.id))
      return vis.map(n => n.label)
    },
    refocus: () => {
      if (activeNodeId && worldLayout[activeNodeId]) {
        focusRef.current = { worldPos: worldLayout[activeNodeId].clone(), endTime: performance.now() + 800 }
      }
    }
  }), [nodes, visibleIds, activeNodeId, camera, worldLayout])

  // Focus on new node for 0.5s
  useEffect(() => {
    if (nodes.length > prevNodeCount.current) {
      prevNodeCount.current = nodes.length
      if (activeNodeId && worldLayout[activeNodeId]) {
        focusRef.current = { worldPos: worldLayout[activeNodeId].clone(), endTime: performance.now() + 500 }
      }
    }
  }, [nodes.length, activeNodeId, worldLayout])

  // Pointer lock
  useEffect(() => {
    const canvas = gl.domElement
    const onClick = () => { if (!document.pointerLockElement) canvas.requestPointerLock?.() }
    const onLockChange = () => { isPointerLocked.current = document.pointerLockElement === canvas }
    const onMove = e => {
      if (!isPointerLocked.current) return
      yaw.current   -= e.movementX * 0.002
      pitch.current  = Math.max(-1.3, Math.min(1.3, pitch.current - e.movementY * 0.002))
    }
    canvas.addEventListener('click', onClick)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('mousemove', onMove)
    return () => {
      canvas.removeEventListener('click', onClick)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('mousemove', onMove)
    }
  }, [gl])

  useEffect(() => {
    const dn = e => {
      keys.current[e.code] = true
      userMoving.current = true
      clearTimeout(moveTimer.current)
      moveTimer.current = setTimeout(() => { userMoving.current = false }, 1200)
      if (e.code === 'Space') e.preventDefault()
    }
    const up = e => { keys.current[e.code] = false }
    window.addEventListener('keydown', dn)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
  }, [])

  useFrame((_, delta) => {
    const speed = 9 * delta

    // Rotation from pointer lock
    if (isPointerLocked.current) {
      camera.rotation.order = 'YXZ'
      camera.rotation.y = yaw.current
      camera.rotation.x = pitch.current
    }

    // WASD movement — pure world-space movement, no group involved
    const fwd   = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0; fwd.normalize()
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);  right.y = 0; right.normalize()
    if (keys.current['KeyW']) camera.position.addScaledVector(fwd, speed)
    if (keys.current['KeyS']) camera.position.addScaledVector(fwd, -speed)
    if (keys.current['KeyA']) camera.position.addScaledVector(right, -speed)
    if (keys.current['KeyD']) camera.position.addScaledVector(right, speed)
    if (keys.current['Space'])      camera.position.y += speed
    if (keys.current['ShiftLeft'] || keys.current['ShiftRight']) camera.position.y -= speed

    // 0.5s soft look-at when new node appears (rotate only, no position move)
    if (focusRef.current && !userMoving.current) {
      const now = performance.now()
      if (now < focusRef.current.endTime) {
        const tgt = focusRef.current.worldPos
        const desired = new THREE.Quaternion()
        const m = new THREE.Matrix4().lookAt(camera.position, tgt, new THREE.Vector3(0, 1, 0))
        desired.setFromRotationMatrix(m)
        camera.quaternion.slerp(desired, 0.05)
        camera.rotation.order = 'YXZ'
        yaw.current   = camera.rotation.y
        pitch.current = camera.rotation.x
      } else {
        focusRef.current = null
      }
    }

    // Update live positions for edge rendering (use NodeMesh lerped positions via worldLayout approx)
    nodes.forEach(n => {
      if (!livePositions.current[n.id]) {
        livePositions.current[n.id] = (worldLayout[n.id] || new THREE.Vector3(0, -80, 0)).clone()
      } else {
        const target = worldLayout[n.id] || new THREE.Vector3(0, -80, 0)
        livePositions.current[n.id].lerp(target, 0.08)
      }
    })
  })

  const getOpacity = id => {
    if (!visibleIds || visibleIds.length === 0) return 1
    if (id === activeNodeId || visibleIds.includes(id)) return 1
    return 0.06
  }
  const getEdgeOp = edge => {
    if (!visibleIds || visibleIds.length === 0) return 1
    const fv = visibleIds.includes(edge.from) || edge.from === activeNodeId
    const tv = visibleIds.includes(edge.to)   || edge.to   === activeNodeId
    return (fv && tv) ? 1 : 0.03
  }

  return (
    <>
      <ambientLight intensity={1.4} />
      <gridHelper args={[500, 100, '#eeeeee', '#f5f5f5']} position={[0, -14, 0]} />

      {edges.map((edge, i) => (
        <EdgeLine
          key={`${edge.from}-${edge.to}-${i}`}
          fromId={edge.from} toId={edge.to}
          targetOpacity={getEdgeOp(edge)}
          livePositions={livePositions}
        />
      ))}

      {nodes.map(node => (
        <NodeMesh
          key={node.id}
          node={node}
          worldPos={worldLayout[node.id] || new THREE.Vector3(0, -80, 0)}
          isActive={node.id === activeNodeId}
          targetOpacity={getOpacity(node.id)}
        />
      ))}
    </>
  )
})

export default function Scene({ sceneRef }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 0.01], fov: 70, near: 0.05, far: 2000 }}
      style={{ background: '#ffffff' }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <SceneContent ref={sceneRef} />
    </Canvas>
  )
}
