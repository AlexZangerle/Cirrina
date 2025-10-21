package at.ac.uibk.dps.cirrina.execution.command;

import at.ac.uibk.dps.cirrina.execution.object.context.Extent;
import at.ac.uibk.dps.cirrina.execution.object.statemachine.StateMachine;

public interface Scope {
  Extent getExtent();

  String getId();
  StateMachine getStateMachine();
}
