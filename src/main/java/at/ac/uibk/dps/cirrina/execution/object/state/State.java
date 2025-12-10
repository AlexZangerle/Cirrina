package at.ac.uibk.dps.cirrina.execution.object.state;

import at.ac.uibk.dps.cirrina.classes.state.StateClass;
import at.ac.uibk.dps.cirrina.csm.Csml.ContextDescription;
import at.ac.uibk.dps.cirrina.execution.command.ActionCommand;
import at.ac.uibk.dps.cirrina.execution.command.CommandFactory;
import at.ac.uibk.dps.cirrina.execution.command.Scope;
import at.ac.uibk.dps.cirrina.execution.object.action.TimeoutAction;
import at.ac.uibk.dps.cirrina.execution.object.context.Context;
import at.ac.uibk.dps.cirrina.execution.object.context.ContextBuilder;
import at.ac.uibk.dps.cirrina.execution.object.context.Extent;
import at.ac.uibk.dps.cirrina.execution.object.statemachine.StateMachine;
import jakarta.annotation.Nullable;
import org.jgrapht.traverse.TopologicalOrderIterator;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

public final class State implements Scope {

  private final Context localContext;
  private final Context staticContext;
  private final @Nullable ContextDescription localContextDescription;

  private final StateClass stateClassObject;

  private final StateMachine parent;

  public State(StateClass stateClassObject, StateMachine parent) {
    this.stateClassObject = stateClassObject;
    this.parent = parent;
    this.localContextDescription = stateClassObject.getLocalContextDescription().orElse(null);
    try {
      this.localContext = stateClassObject
              .getLocalContextDescription()
              .map(ContextBuilder::from)
              .orElseGet(ContextBuilder::from)
              .inMemoryContext(true)
              .build();
    } catch (IOException ignored) {
      throw new IllegalStateException("Failed to build local context for state: " + stateClassObject.getName());
    }
    try {
      this.staticContext = stateClassObject
              .getStaticContextDescription()
              .map(ContextBuilder::from)
              .orElseGet(ContextBuilder::from)
              .inMemoryContext(true)
              .build();
    } catch (IOException ignored) {
      throw new IllegalStateException("Failed to build static context for state: " + stateClassObject.getName());
    }
  }

  @Override
  public Extent getExtent() {
    return parent.getExtent().extend(staticContext).extend(localContext);
  }

  @Override
  public String getId() {
    return parent.getId();
  }

  @Override
  public StateMachine getStateMachine() {
    return this.parent;
  }

  public StateClass getStateObject() {
    return stateClassObject;
  }

  public List<ActionCommand> getEntryActionCommands(CommandFactory commandFactory) {
    List<ActionCommand> actionCommands = new ArrayList<>();

    new TopologicalOrderIterator<>(stateClassObject.getEntryActionGraph()).forEachRemaining(
      action -> actionCommands.add(commandFactory.createActionCommand(action))
    );

    return actionCommands;
  }

  public List<ActionCommand> getWhileActionCommands(CommandFactory commandFactory) {
    List<ActionCommand> actionCommands = new ArrayList<>();

    new TopologicalOrderIterator<>(stateClassObject.getWhileActionGraph()).forEachRemaining(
      action -> actionCommands.add(commandFactory.createActionCommand(action))
    );

    return actionCommands;
  }

  public List<ActionCommand> getExitActionCommands(CommandFactory commandFactory) {
    List<ActionCommand> actionCommands = new ArrayList<>();

    new TopologicalOrderIterator<>(stateClassObject.getExitActionGraph()).forEachRemaining(action ->
      actionCommands.add(commandFactory.createActionCommand(action))
    );

    return actionCommands;
  }

  public List<TimeoutAction> getTimeoutActionObjects() {
    List<TimeoutAction> timeoutActionObjects = new ArrayList<>();

    new TopologicalOrderIterator<>(stateClassObject.getAfterActionGraph()).forEachRemaining(
      timeoutActionObject -> timeoutActionObjects.add((TimeoutAction) timeoutActionObject)
    );

    return timeoutActionObjects;
  }

  public void resetLocalContext() {
    try {
      ContextBuilder.resetContextToDefault(localContext, localContextDescription);
    } catch (IOException ignored) {
      throw new IllegalStateException("Failed to reset local context for state: " + stateClassObject.getName());
    }
  }
}
