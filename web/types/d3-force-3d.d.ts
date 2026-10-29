declare module "d3-force-3d" {
  interface ForceNode {
    layer: string;
  }

  interface RadialForce<Node extends ForceNode> {
    strength(value: number | ((node: Node) => number)): RadialForce<Node>;
  }

  interface CollideForce<Node extends ForceNode> {
    radius(value: number | ((node: Node) => number)): CollideForce<Node>;
  }

  export function forceRadial<Node extends ForceNode>(
    radius: number | ((node: Node) => number),
    x?: number,
    y?: number,
  ): RadialForce<Node>;

  export function forceCollide<Node extends ForceNode>(
    radius: number | ((node: Node) => number),
  ): CollideForce<Node>;
}
