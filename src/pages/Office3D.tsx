import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { officeStateBadge } from '../office-state.ts'
import { agentLook } from '../agents.ts'
import { clampTarget, createLayout, idlePlan, placementFor, walkPath, type OfficeLayout, type Placement, type Vec3 } from '../office3d-layout.ts'
import { Environment } from '../scene3d/environment.tsx'
import { RBox, PcTower, WorkDesk } from '../scene3d/props.tsx'
import type { OfficeStation } from '../types.ts'

// 3D view of the same Office snapshot the 2D view renders. Positions come from each station's
// room, roomPosition and seat, so the 3D office shows exactly the states the server derived.

type Registry<T> = MutableRefObject<Map<string, T>>

function Character({ station, placement, layout, onSelect, anchor }: { station: OfficeStation; placement: Placement; layout: OfficeLayout; onSelect: (station: OfficeStation, trigger: HTMLElement | null) => void; anchor: (object: THREE.Object3D | null) => void }) {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const leftLeg = useRef<THREE.Mesh>(null)
  const rightLeg = useRef<THREE.Mesh>(null)
  const leftArm = useRef<THREE.Mesh>(null)
  const rightArm = useRef<THREE.Mesh>(null)
  const colors = agentLook(station.id)
  const offline = station.state === 'Offline'
  const unknown = station.state === 'Unknown'
  const tint = (color: string) => offline ? '#7b7f7d' : color
  // Only the first placement is applied as a prop; later changes are walked to via the aisle.
  const [start] = useState<Vec3>(() => placement.position)
  const path = useRef<THREE.Vector3[]>([])
  const destination = placement.position.join(',')
  useEffect(() => {
    const group = root.current
    if (!group) return
    const [x, , z] = placement.position
    path.current = walkPath([group.position.x, group.position.z], [x, z], layout).map(([px, pz]) => new THREE.Vector3(px, 0, pz))
    // placement.position is captured through `destination`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination])

  useFrame((state, delta) => {
    const group = root.current
    if (!group) return
    const time = state.clock.elapsedTime
    const next = path.current[0]
    let walking = false
    if (next) {
      const toNext = next.clone().sub(group.position)
      toNext.y = 0
      const distance = toNext.length()
      if (distance < 0.04) {
        path.current.shift()
      } else {
        walking = true
        group.position.add(toNext.normalize().multiplyScalar(Math.min(distance, delta * 2.6)))
        const heading = Math.atan2(toNext.x, toNext.z)
        group.rotation.y += Math.atan2(Math.sin(heading - group.rotation.y), Math.cos(heading - group.rotation.y)) * 0.25
      }
    }
    if (!walking) group.rotation.y += Math.atan2(Math.sin(placement.facing - group.rotation.y), Math.cos(placement.facing - group.rotation.y)) * 0.12
    const swing = walking ? Math.sin(time * 10) * 0.6 : 0
    const seated = !walking && placement.seated
    if (leftLeg.current && rightLeg.current) {
      leftLeg.current.rotation.x = seated ? -Math.PI / 2.2 : swing
      rightLeg.current.rotation.x = seated ? -Math.PI / 2.2 : -swing
    }
    if (leftArm.current && rightArm.current) {
      const typing = !walking && (station.state === 'Working' || station.state === 'Reviewing')
      const talking = !walking && station.state === 'Collaborating'
      leftArm.current.rotation.x = walking ? -swing : typing ? -1.1 + Math.sin(time * 14) * 0.12 : talking ? -0.4 + Math.sin(time * 3) * 0.3 : 0
      rightArm.current.rotation.x = walking ? swing : typing ? -1.1 + Math.cos(time * 14) * 0.12 : 0
    }
    if (body.current) {
      const talk = station.state === 'Collaborating' && !walking ? Math.abs(Math.sin(time * 5)) * 0.03 : 0
      const breathe = station.state === 'Idle' ? Math.sin(time * 2) * 0.015 : 0
      body.current.position.y = (seated ? -0.14 : 0) + talk + breathe
    }
  })

  return <group ref={root} position={start}>
    <group ref={body} onClick={(event) => { event.stopPropagation(); onSelect(station, null) }} onPointerOver={() => { document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }}>
      <mesh ref={leftLeg} position={[-0.11, 0.66, 0]} castShadow geometry={legGeometry}><meshStandardMaterial color={tint(colors.pants)} roughness={0.8}/></mesh>
      <mesh ref={rightLeg} position={[0.11, 0.66, 0]} castShadow geometry={legGeometry}><meshStandardMaterial color={tint(colors.pants)} roughness={0.8}/></mesh>
      <RBox position={[0, 0.98, 0]} size={[0.48, 0.58, 0.3]} radius={0.07} color={tint(colors.shirt)} roughness={0.85}/>
      <mesh ref={leftArm} position={[-0.31, 1.2, 0]} castShadow geometry={armGeometry}><meshStandardMaterial color={tint(colors.shirt)} roughness={0.85}/></mesh>
      <mesh ref={rightArm} position={[0.31, 1.2, 0]} castShadow geometry={armGeometry}><meshStandardMaterial color={tint(colors.shirt)} roughness={0.85}/></mesh>
      <RBox position={[0, 1.5, 0]} size={[0.4, 0.4, 0.37]} radius={0.08} color={tint(colors.skin)} roughness={0.7}/>
      <RBox position={[0, 1.72, -0.02]} size={[0.43, 0.13, 0.41]} radius={0.05} color={tint(colors.hair)} roughness={0.9}/>
      <RBox position={[0, 1.58, -0.19]} size={[0.43, 0.3, 0.06]} radius={0.03} color={tint(colors.hair)} roughness={0.9}/>
      <RBox position={[-0.09, 1.52, 0.186]} size={[0.06, 0.07, 0.01]} radius={0.004} color="#17201e" shadow={false}/>
      <RBox position={[0.09, 1.52, 0.186]} size={[0.06, 0.07, 0.01]} radius={0.004} color="#17201e" shadow={false}/>
      <RBox position={[0, 1.4, 0.186]} size={[0.12, 0.025, 0.01]} radius={0.004} color="#9a5a44" shadow={false}/>
      {unknown && <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.45, 0.55, 24]}/><meshBasicMaterial color="#e9c47b" transparent opacity={0.85}/></mesh>}
      <object3D ref={anchor} position={[0, 2.05, 0]}/>
    </group>
  </group>
}

// Legs and arms pivot at the hip / shoulder: translate the geometry so its top sits at the origin.
const legGeometry = new THREE.BoxGeometry(0.17, 0.62, 0.2).translate(0, -0.31, 0)
const armGeometry = new THREE.BoxGeometry(0.12, 0.52, 0.14).translate(0, -0.26, 0)

/** A CLI tool (no character): a stationary computer station at its desk, with a screen that glows when the tool is working. */
function ToolStation({ station, layout, onSelect, anchor }: { station: OfficeStation; layout: OfficeLayout; onSelect: (station: OfficeStation, trigger: HTMLElement | null) => void; anchor: (object: THREE.Object3D | null) => void }) {
  const [x, , z] = placementFor(station, layout).position
  const active = station.state === 'Working' || station.state === 'Reviewing' || station.state === 'Collaborating'
  return <group position={[x, 0, z + 0.75]}>
    <WorkDesk position={[0, 0, 0]} active={active} withChair={false}/>
    <PcTower position={[-0.66, 0, -0.3]}/>
    <group position={[0, 1.55, 0.22]} onClick={(event) => { event.stopPropagation(); onSelect(station, null) }} onPointerOver={() => { document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }}>
      <object3D ref={anchor}/>
    </group>
  </group>
}

/**
 * Screen-space labels: each frame, project every anchor into the canvas and move its DOM label
 * there directly (no React re-render). Labels live outside the Canvas, so they unmount cleanly
 * and use the page's own styles and focus handling.
 */
function LabelProjector({ anchors, labels }: { anchors: Registry<THREE.Object3D>; labels: Registry<HTMLElement> }) {
  const point = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    const projected: { element: HTMLElement; x: number; y: number; depth: number }[] = []
    for (const [key, object] of anchors.current) {
      const element = labels.current.get(key)
      if (!element) continue
      object.getWorldPosition(point).project(camera)
      const visible = point.z < 1 && Math.abs(point.x) <= 1.1 && Math.abs(point.y) <= 1.1
      element.style.visibility = visible ? 'visible' : 'hidden'
      if (visible) projected.push({ element, x: ((point.x + 1) / 2) * size.width, y: ((1 - point.y) / 2) * size.height, depth: point.z })
    }
    // Nearest labels keep their spot; a farther label that would overlap one already placed is
    // lifted above it, so every agent stays readable and clickable.
    projected.sort((a, b) => a.depth - b.depth)
    const placed: { left: number; right: number; top: number; bottom: number }[] = []
    for (const label of projected) {
      const width = label.element.offsetWidth
      const height = label.element.offsetHeight
      const x = Math.min(Math.max(label.x, width / 2 + 4), size.width - width / 2 - 4)
      let bottom = label.y
      const left = x - width / 2
      const right = x + width / 2
      for (let guard = 0; guard < 6; guard += 1) {
        const hit = placed.find((box) => left < box.right && right > box.left && bottom - height < box.bottom && bottom > box.top)
        if (!hit) break
        bottom = hit.top - 4
      }
      placed.push({ left, right, top: bottom - height, bottom })
      label.element.style.transform = `translate(${x}px, ${Math.max(bottom, height + 4)}px) translate(-50%, -100%)`
      label.element.style.zIndex = String(Math.round((1 - label.depth) * 10_000))
    }
  })
  return null
}

export interface ViewHandle { reset: () => void }

/** Orbit (drag), pan (right-drag, two fingers, arrow keys or pan mode) and zoom, kept in bounds. */
const Controls = forwardRef<ViewHandle, { panMode: boolean; keyTarget: HTMLElement | null; layout: OfficeLayout }>(function Controls({ panMode, keyTarget, layout }, handle) {
  const { camera, gl, size } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  const { target: cameraTarget, offset: cameraOffset } = layout.camera
  const target = useMemo(() => new THREE.Vector3(...cameraTarget), [cameraTarget])
  const frame = useMemo(() => () => {
    const aspect = size.width / Math.max(size.height, 1)
    const offset = new THREE.Vector3(...cameraOffset)
    // Narrow (portrait) views need to back off so the whole building fits across.
    offset.setLength(offset.length() * Math.max(1, 1.2 / aspect))
    const focus = target.clone().set(aspect < 1 ? cameraTarget[0] - 1.4 : cameraTarget[0], cameraTarget[1], aspect < 1 ? 0.8 : cameraTarget[2])
    const orbit = controls.current
    // An undamped update applies and clears any momentum left from an earlier drag,
    // so it has to happen before the camera is placed, not after.
    if (orbit) { orbit.enableDamping = false; orbit.update() }
    camera.position.copy(focus).add(offset)
    camera.lookAt(focus)
    if (!orbit) return
    orbit.target.copy(focus)
    orbit.update()
    orbit.enableDamping = true
  }, [camera, size.width, size.height, target, cameraOffset, cameraTarget])

  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement)
    orbit.enableDamping = true
    orbit.screenSpacePanning = false // pan across the floor, not up into the sky
    orbit.minDistance = 5
    orbit.maxDistance = 48
    orbit.minPolarAngle = 0.2
    orbit.maxPolarAngle = 1.32
    orbit.keyPanSpeed = 25
    controls.current = orbit
    frame()
    return () => { orbit.dispose(); controls.current = null }
    // frame() only sets the initial view; re-running it on resize is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl])
  useEffect(() => { frame() }, [frame])
  useEffect(() => {
    const orbit = controls.current
    if (!orbit) return
    orbit.mouseButtons.LEFT = panMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE
    orbit.mouseButtons.RIGHT = panMode ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN
    orbit.touches.ONE = panMode ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE
  }, [panMode])
  useEffect(() => {
    const orbit = controls.current
    if (!orbit || !keyTarget) return
    orbit.listenToKeyEvents(keyTarget)
    return () => orbit.stopListenToKeyEvents()
  }, [keyTarget])
  useImperativeHandle(handle, () => ({ reset: frame }), [frame])

  useFrame(() => {
    const orbit = controls.current
    if (!orbit) return
    orbit.update()
    const [x, z] = clampTarget(orbit.target.x, orbit.target.z, layout.pan)
    if (x !== orbit.target.x || z !== orbit.target.z) {
      const shift = new THREE.Vector3(x - orbit.target.x, 0, z - orbit.target.z)
      orbit.target.add(shift)
      camera.position.add(shift)
    }
  })
  return null
})

function register<T>(registry: Registry<T>, key: string) {
  return (value: T | null) => { if (value) registry.current.set(key, value); else registry.current.delete(key) }
}

/** Current time, refreshed every `interval` ms. */
function useClock(interval: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval)
    return () => window.clearInterval(timer)
  }, [interval])
  return now
}

function useThemeName(): 'dark' | 'light' {
  const read = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const [theme, setTheme] = useState<'dark' | 'light'>(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

/** Day in the light theme; evening in the dark theme, when the lamps in the scene switch on. */
function Lighting({ theme }: { theme: 'dark' | 'light' }) {
  const day = theme === 'light'
  return <>
    <color attach="background" args={[day ? '#bfe0ef' : '#1a2335']}/>
    <fog attach="fog" args={[day ? '#bfe0ef' : '#1a2335', 38, 75]}/>
    <hemisphereLight args={[day ? '#fff4e0' : '#7f95bd', day ? '#5d7a4c' : '#1e2620', day ? 1.1 : 0.32]}/>
    <directionalLight position={[10, 16, 9]} intensity={day ? 2.4 : 0.75} color={day ? '#fff1d6' : '#ff9a5a'} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-camera-left={-16} shadow-camera-right={16} shadow-camera-top={16} shadow-camera-bottom={-16} shadow-camera-far={60}/>
    <ambientLight intensity={day ? 0.35 : 0.14} color={day ? '#ffffff' : '#8fa4d8'}/>
  </>
}

export default function Office3D({ stations, onSelect }: { stations: OfficeStation[]; onSelect: (station: OfficeStation, trigger: HTMLElement | null) => void }) {
  const anchors = useRef(new Map<string, THREE.Object3D>())
  const labels = useRef(new Map<string, HTMLElement>())
  const view = useRef<ViewHandle>(null)
  const [panMode, setPanMode] = useState(false)
  const [keyTarget, setKeyTarget] = useState<HTMLElement | null>(null)
  const theme = useThemeName()
  const now = useClock(2000)
  // One unlabeled desk per agent (hot desking); the building is sized for the crew.
  const layout = useMemo(() => createLayout(stations.length), [stations.length])
  // Idle agents wander between the lounge, the game room, the pantry and the street food
  // (decorative only), spread so no two share a spot.
  const idleSeats = stations.filter((station) => station.state === 'Idle' && station.room === 'Lounge').map((station) => station.seat)
  const plan = idlePlan(idleSeats, now, layout)
  // CLI tools never wander: they are a stationary computer station at their desk.
  const wandering = (station: OfficeStation) => station.isTool ? undefined : station.state === 'Idle' && station.room === 'Lounge' ? plan.get(station.seat) : undefined
  // Agents at the meeting table take the next free place around it.
  const meetingOrder = stations.filter((station) => station.roomPosition === 'meeting-area').map((station) => station.id)
  const placement = (station: OfficeStation) => wandering(station)?.placement ?? placementFor(station, layout, Math.max(0, meetingOrder.indexOf(station.id)))
  const occupiedSeats = new Set(stations.filter((station) => station.room === 'Workspace' && station.roomPosition !== 'meeting-area' && station.state !== 'Offline').map((station) => station.seat))
  // Tool stations draw their own desk (with PC tower), so the shared row skips their seats.
  const toolSeats = new Set(stations.filter((station) => station.isTool).map((station) => station.seat))
  return <div className="office-3d" ref={setKeyTarget} tabIndex={0} role="region" aria-label="3D office. Drag to rotate, right-drag or two fingers to pan, scroll to zoom, arrow keys pan when focused.">
    <Canvas shadows dpr={[1, 2]} camera={{ position: [-3, 13, 16], fov: 40, near: 0.5, far: 150 }} gl={{ antialias: true }}>
      <Lighting theme={theme}/>
      <Environment night={theme === 'dark'} layout={layout}/>
      {layout.desks.map((position, index) => toolSeats.has(index + 1) ? null : <WorkDesk key={index} position={position} active={occupiedSeats.has(index + 1)} withChair/>)}
      {stations.map((station) => station.isTool
        ? <ToolStation key={station.id} station={station} layout={layout} onSelect={onSelect} anchor={register(anchors, `agent-${station.id}`)}/>
        : <Character key={station.id} station={station} placement={placement(station)} layout={layout} onSelect={onSelect} anchor={register(anchors, `agent-${station.id}`)}/>)}
      <LabelProjector anchors={anchors} labels={labels}/>
      <Controls key={layout.deskCount} ref={view} panMode={panMode} keyTarget={keyTarget} layout={layout}/>
    </Canvas>
    <div className="office-3d-labels">
      {stations.map((station) => {
        const badge = officeStateBadge(station.state)
        const busy = ['Working', 'Reviewing', 'Collaborating'].includes(station.state)
        const idle = wandering(station)
        return <button key={station.id} ref={register(labels, `agent-${station.id}`)} type="button" className={`agent-tag-3d state-${station.state.toLowerCase()}`} onClick={(event) => onSelect(station, event.currentTarget)} aria-label={`${station.name}. ${station.state}.${station.activity ? ` ${station.activity}.` : ''}${idle ? ` ${idle.placement.label ?? idle.stop.label}.` : ''} Open station details.`}>
          {busy && station.activity && !station.isTool && <span className="speech speech-3d">{station.activity}</span>}
          {idle && <span className="speech speech-3d speech-idle">{idle.placement.label ?? idle.stop.label}</span>}
          <span className="agent-tag-row"><span className="pixel-station-name">{station.name}</span><span className={`badge ${badge.tone}`}>{station.state === 'Idle' ? 'Idle' : station.state}</span></span>
        </button>
      })}
    </div>
    <div className="office-3d-tools">
      <button type="button" className={panMode ? 'active' : ''} aria-pressed={panMode} onClick={() => setPanMode((value) => !value)} title="Drag moves the view instead of rotating it">✥ Geser</button>
      <button type="button" onClick={() => view.current?.reset()} title="Back to the starting view">↺ Reset view</button>
    </div>
  </div>
}
