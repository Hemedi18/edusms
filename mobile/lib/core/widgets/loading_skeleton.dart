import 'package:flutter/material.dart';

/// Accessible loading placeholder that respects OS reduced-motion preferences.
class LoadingSkeleton extends StatefulWidget {
  const LoadingSkeleton({
    super.key,
    this.height = 76,
    this.count = 3,
  });

  final double height;
  final int count;

  @override
  State<LoadingSkeleton> createState() => _LoadingSkeletonState();
}

class _LoadingSkeletonState extends State<LoadingSkeleton>
    with SingleTickerProviderStateMixin {
  AnimationController? _controller;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    if (reduceMotion) {
      _controller?.stop();
    } else if (_controller == null) {
      _controller = AnimationController(
        vsync: this,
        duration: const Duration(milliseconds: 1100),
      )..repeat(reverse: true);
    } else if (!_controller!.isAnimating) {
      _controller!.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final baseColor = Theme.of(context).colorScheme.surfaceContainerHighest;
    final ctrl = _controller;

    Widget buildBoxes(double alpha) {
      return Column(
        children: List.generate(widget.count, (index) {
          return Padding(
            padding: EdgeInsets.only(bottom: index == widget.count - 1 ? 0 : 12),
            child: Container(
              height: widget.height,
              width: double.infinity,
              decoration: BoxDecoration(
                color: baseColor.withValues(alpha: alpha),
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          );
        }),
      );
    }

    if (ctrl == null || MediaQuery.disableAnimationsOf(context)) {
      return buildBoxes(0.65);
    }

    return AnimatedBuilder(
      animation: ctrl,
      builder: (context, _) {
        final alpha = 0.40 + (ctrl.value * 0.40);
        return buildBoxes(alpha);
      },
    );
  }
}
