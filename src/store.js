import { create } from 'zustand'

export const useStore = create((set) => ({
  nodes: [],
  edges: [],
  activeNodeId: null,
  visibleNodeIds: [],
  narration: '',        // spoken (clean) version
  rawNarration: '',     // display version — may contain math notation
  status: 'idle',

  setStatus:       (status)       => set({ status }),
  setNarration:    (narration)    => set({ narration }),
  setRawNarration: (rawNarration) => set({ rawNarration }),

  updateScene: ({ nodes, edges, activeNodeId, visibleNodeIds }) => {
    set({
      nodes,
      edges,
      activeNodeId:   activeNodeId   || null,
      visibleNodeIds: visibleNodeIds || [],
    })
  },

  reset: () => set({
    nodes: [], edges: [], activeNodeId: null,
    visibleNodeIds: [], narration: '', rawNarration: '', status: 'idle'
  }),
}))
