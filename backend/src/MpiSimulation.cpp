#include "MpiSimulation.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <utility>

namespace neon_rush {
namespace {

struct VehicleWire {
  std::uint64_t id;
  double x;
  double z;
  double speed;
  double direction;
  double collisionRadius;
  int active;
};

struct PairWire {
  std::uint64_t firstId;
  std::uint64_t secondId;
};

void checkMpi(const int result, const char* operation) {
  if (result == MPI_SUCCESS) {
    return;
  }

  char message[MPI_MAX_ERROR_STRING]{};
  int length = 0;
  MPI_Error_string(result, message, &length);
  throw std::runtime_error(
      std::string(operation) + ": " +
      std::string(message, static_cast<std::size_t>(length)));
}

std::vector<int> makeCounts(const std::size_t total,
                            const int processCount) {
  if (total > static_cast<std::size_t>(
                  std::numeric_limits<int>::max())) {
    throw std::invalid_argument(
        "MPI vehicle count exceeds the supported count limit");
  }

  std::vector<int> counts(static_cast<std::size_t>(processCount), 0);
  const auto base = total / static_cast<std::size_t>(processCount);
  const auto remainder =
      total % static_cast<std::size_t>(processCount);
  for (int process = 0; process < processCount; ++process) {
    const auto index = static_cast<std::size_t>(process);
    counts[index] = static_cast<int>(
        base + (index < remainder ? 1U : 0U));
  }
  return counts;
}

std::vector<int> makeDisplacements(const std::vector<int>& counts) {
  std::vector<int> displacements(counts.size(), 0);
  int total = 0;
  for (std::size_t index = 0; index < counts.size(); ++index) {
    displacements[index] = total;
    total += counts[index];
  }
  return displacements;
}

VehicleWire toWire(const Vehicle& vehicle) {
  return {
      static_cast<std::uint64_t>(vehicle.id),
      vehicle.x,
      vehicle.z,
      vehicle.speed,
      vehicle.direction,
      vehicle.collisionRadius,
      vehicle.active ? 1 : 0};
}

Vehicle fromWire(const VehicleWire& wire) {
  Vehicle vehicle;
  vehicle.id = static_cast<std::size_t>(wire.id);
  vehicle.x = wire.x;
  vehicle.z = wire.z;
  vehicle.speed = wire.speed;
  vehicle.direction = wire.direction;
  vehicle.collisionRadius = wire.collisionRadius;
  vehicle.active = wire.active != 0;
  return vehicle;
}

std::vector<VehicleWire> toWire(
    const std::vector<Vehicle>& vehicles) {
  std::vector<VehicleWire> result;
  result.reserve(vehicles.size());
  for (const auto& vehicle : vehicles) {
    result.push_back(toWire(vehicle));
  }
  return result;
}

std::int64_t cellXFor(const Vehicle& vehicle,
                      const double cellSize) {
  const double cell = std::floor(vehicle.x / cellSize);
  if (!std::isfinite(cell) ||
      cell < static_cast<double>(
                 std::numeric_limits<std::int64_t>::min()) ||
      cell >= static_cast<double>(
                  std::numeric_limits<std::int64_t>::max())) {
    throw std::out_of_range("vehicle X position exceeds MPI grid bounds");
  }
  return static_cast<std::int64_t>(cell);
}

MPI_Datatype createVehicleType() {
  VehicleWire sample{};
  MPI_Aint base = 0;
  MPI_Aint displacements[7]{};
  checkMpi(MPI_Get_address(&sample, &base), "MPI_Get_address");
  checkMpi(MPI_Get_address(&sample.id, &displacements[0]),
           "MPI_Get_address");
  checkMpi(MPI_Get_address(&sample.x, &displacements[1]),
           "MPI_Get_address");
  checkMpi(MPI_Get_address(&sample.z, &displacements[2]),
           "MPI_Get_address");
  checkMpi(MPI_Get_address(&sample.speed, &displacements[3]),
           "MPI_Get_address");
  checkMpi(MPI_Get_address(&sample.direction, &displacements[4]),
           "MPI_Get_address");
  checkMpi(MPI_Get_address(&sample.collisionRadius, &displacements[5]),
           "MPI_Get_address");
  checkMpi(MPI_Get_address(&sample.active, &displacements[6]),
           "MPI_Get_address");
  for (auto& displacement : displacements) {
    displacement -= base;
  }

  const int blockLengths[7] = {1, 1, 1, 1, 1, 1, 1};
  const MPI_Datatype types[7] = {
      MPI_UINT64_T,
      MPI_DOUBLE,
      MPI_DOUBLE,
      MPI_DOUBLE,
      MPI_DOUBLE,
      MPI_DOUBLE,
      MPI_INT};
  MPI_Datatype rawType = MPI_DATATYPE_NULL;
  MPI_Datatype resizedType = MPI_DATATYPE_NULL;
  checkMpi(
      MPI_Type_create_struct(
          7, blockLengths, displacements, types, &rawType),
      "MPI_Type_create_struct");
  checkMpi(
      MPI_Type_create_resized(
          rawType, 0, static_cast<MPI_Aint>(sizeof(VehicleWire)),
          &resizedType),
      "MPI_Type_create_resized");
  MPI_Type_free(&rawType);
  checkMpi(MPI_Type_commit(&resizedType), "MPI_Type_commit");
  return resizedType;
}

MPI_Datatype createPairType() {
  MPI_Datatype type = MPI_DATATYPE_NULL;
  checkMpi(
      MPI_Type_contiguous(2, MPI_UINT64_T, &type),
      "MPI_Type_contiguous");
  checkMpi(MPI_Type_commit(&type), "MPI_Type_commit");
  return type;
}

template <typename Record>
std::vector<Record> exchangeByRank(
    const std::vector<std::vector<Record>>& byRank,
    const MPI_Datatype recordType,
    const MPI_Comm communicator,
    const int processCount) {
  std::vector<int> sendCounts(
      static_cast<std::size_t>(processCount), 0);
  for (int process = 0; process < processCount; ++process) {
    const auto count = byRank[static_cast<std::size_t>(process)].size();
    if (count > static_cast<std::size_t>(
                    std::numeric_limits<int>::max())) {
      throw std::overflow_error("MPI per-process message is too large");
    }
    sendCounts[static_cast<std::size_t>(process)] =
        static_cast<int>(count);
  }

  std::vector<int> receiveCounts(
      static_cast<std::size_t>(processCount), 0);
  checkMpi(
      MPI_Alltoall(
          sendCounts.data(), 1, MPI_INT,
          receiveCounts.data(), 1, MPI_INT,
          communicator),
      "MPI_Alltoall counts");

  const auto sendDisplacements = makeDisplacements(sendCounts);
  const auto receiveDisplacements = makeDisplacements(receiveCounts);
  const int sendTotal =
      sendCounts.empty()
          ? 0
          : sendDisplacements.back() + sendCounts.back();
  const int receiveTotal =
      receiveCounts.empty()
          ? 0
          : receiveDisplacements.back() + receiveCounts.back();

  std::vector<Record> sendBuffer;
  sendBuffer.reserve(static_cast<std::size_t>(sendTotal));
  for (const auto& destination : byRank) {
    sendBuffer.insert(
        sendBuffer.end(), destination.begin(), destination.end());
  }

  std::vector<Record> received(
      static_cast<std::size_t>(receiveTotal));
  checkMpi(
      MPI_Alltoallv(
          sendBuffer.data(),
          sendCounts.data(),
          sendDisplacements.data(),
          recordType,
          received.data(),
          receiveCounts.data(),
          receiveDisplacements.data(),
          recordType,
          communicator),
      "MPI_Alltoallv records");
  return received;
}

template <typename Record>
std::vector<Record> gatherRecords(const std::vector<Record>& local,
                                  const MPI_Datatype recordType,
                                  const MPI_Comm communicator,
                                  const int rank,
                                  const int processCount,
                                  const int root) {
  if (root < 0 || root >= processCount) {
    throw std::invalid_argument("MPI gather root is out of range");
  }

  if (local.size() > static_cast<std::size_t>(
                         std::numeric_limits<int>::max())) {
    throw std::overflow_error("MPI local gather buffer is too large");
  }

  const int localCount = static_cast<int>(local.size());
  std::vector<int> counts(
      rank == root ? static_cast<std::size_t>(processCount) : 0);
  checkMpi(
      MPI_Gather(
          &localCount, 1, MPI_INT,
          rank == root ? counts.data() : nullptr,
          1, MPI_INT, root, communicator),
      "MPI_Gather counts");

  std::vector<int> displacements;
  std::vector<Record> result;
  if (rank == root) {
    displacements = makeDisplacements(counts);
    const int total =
        counts.empty() ? 0 : displacements.back() + counts.back();
    result.resize(static_cast<std::size_t>(total));
  }

  checkMpi(
      MPI_Gatherv(
          local.data(), localCount, recordType,
          rank == root ? result.data() : nullptr,
          rank == root ? counts.data() : nullptr,
          rank == root ? displacements.data() : nullptr,
          recordType, root, communicator),
      "MPI_Gatherv records");
  return result;
}

}  // namespace

MpiSimulation MpiSimulation::create(
    const std::size_t vehicleCount,
    const MPI_Comm communicator) {
  int rank = 0;
  checkMpi(MPI_Comm_rank(communicator, &rank), "MPI_Comm_rank");
  std::vector<Vehicle> rootVehicles;
  if (rank == 0) {
    rootVehicles = makeVehicles(vehicleCount);
  }
  return MpiSimulation(
      std::move(rootVehicles), vehicleCount, communicator);
}

MpiSimulation::MpiSimulation(std::vector<Vehicle> rootVehicles,
                             const std::size_t vehicleCount,
                             const MPI_Comm communicator)
    : communicator_(communicator),
      vehicleCount_(vehicleCount) {
  checkMpi(MPI_Comm_rank(communicator_, &rank_), "MPI_Comm_rank");
  checkMpi(
      MPI_Comm_size(communicator_, &processCount_), "MPI_Comm_size");
  if (processCount_ < 1) {
    throw std::invalid_argument("MPI communicator must not be empty");
  }
  std::uint64_t rootCount =
      rank_ == 0 ? static_cast<std::uint64_t>(vehicleCount_) : 0;
  double communicationStart = MPI_Wtime();
  checkMpi(
      MPI_Bcast(&rootCount, 1, MPI_UINT64_T, 0, communicator_),
      "MPI_Bcast vehicle count");
  int localCountMatches =
      rootCount == static_cast<std::uint64_t>(vehicleCount_) ? 1 : 0;
  int allCountMatches = 0;
  checkMpi(
      MPI_Allreduce(
          &localCountMatches,
          &allCountMatches,
          1,
          MPI_INT,
          MPI_MIN,
          communicator_),
      "MPI_Allreduce vehicle count validation");
  localCommunicationSeconds_ += MPI_Wtime() - communicationStart;
  if (allCountMatches == 0) {
    throw std::invalid_argument(
        "vehicle count differs between MPI processes");
  }
  if (rootCount > static_cast<std::uint64_t>(
                      std::numeric_limits<int>::max())) {
    throw std::invalid_argument(
        "MPI vehicle count exceeds the supported count limit");
  }

  vehicleType_ = createVehicleType();
  const auto counts = makeCounts(vehicleCount_, processCount_);
  const auto displacements = makeDisplacements(counts);
  std::vector<VehicleWire> rootWire;
  int rootInputValid = 1;
  if (rank_ == 0) {
    if (rootVehicles.size() != vehicleCount_) {
      rootInputValid = 0;
    } else {
      std::unordered_set<std::size_t> ids;
      ids.reserve(rootVehicles.size());
      for (const auto& vehicle : rootVehicles) {
        try {
          validateVehicle(vehicle);
        } catch (const std::invalid_argument&) {
          rootInputValid = 0;
          break;
        }
        if (!ids.insert(vehicle.id).second) {
          rootInputValid = 0;
          break;
        }
      }
      if (rootInputValid != 0) {
        rootWire = toWire(rootVehicles);
      }
    }
  }
  communicationStart = MPI_Wtime();
  checkMpi(
      MPI_Bcast(&rootInputValid, 1, MPI_INT, 0, communicator_),
      "MPI_Bcast root input validation");
  localCommunicationSeconds_ += MPI_Wtime() - communicationStart;
  if (rootInputValid == 0) {
    MPI_Type_free(&vehicleType_);
    throw std::invalid_argument(
        "root vehicles must be valid, uniquely identified, and match the requested count");
  }

  const int localCount = counts[static_cast<std::size_t>(rank_)];
  std::vector<VehicleWire> localWire(
      static_cast<std::size_t>(localCount));
  communicationStart = MPI_Wtime();
  checkMpi(
      MPI_Scatterv(
          rank_ == 0 ? rootWire.data() : nullptr,
          counts.data(),
          displacements.data(),
          vehicleType_,
          localWire.data(),
          localCount,
          vehicleType_,
          0,
          communicator_),
      "MPI_Scatterv initial vehicles");
  localCommunicationSeconds_ += MPI_Wtime() - communicationStart;

  localVehicles_.reserve(localWire.size());
  for (const auto& wire : localWire) {
    localVehicles_.push_back(fromWire(wire));
  }

  double localMaximumRadius = 0.0;
  for (const auto& vehicle : localVehicles_) {
    localMaximumRadius =
        std::max(localMaximumRadius, vehicle.collisionRadius);
  }
  double globalMaximumRadius = 0.0;
  communicationStart = MPI_Wtime();
  checkMpi(
      MPI_Allreduce(
          &localMaximumRadius,
          &globalMaximumRadius,
          1,
          MPI_DOUBLE,
          MPI_MAX,
          communicator_),
      "MPI_Allreduce maximum radius");
  localCommunicationSeconds_ += MPI_Wtime() - communicationStart;
  collisionCellSize_ =
      globalMaximumRadius > 0.0 ? 2.0 * globalMaximumRadius : 2.0;

  state_.vehicleCount = vehicleCount_;
}

MpiSimulation::~MpiSimulation() {
  int finalized = 0;
  MPI_Finalized(&finalized);
  if (!finalized && vehicleType_ != MPI_DATATYPE_NULL) {
    MPI_Type_free(&vehicleType_);
  }
}

void MpiSimulation::updateLocalVehicles(const double deltaTime) {
  for (auto& vehicle : localVehicles_) {
    if (!vehicle.active) {
      continue;
    }
    vehicle.x += std::cos(vehicle.direction) * vehicle.speed * deltaTime;
    vehicle.z += std::sin(vehicle.direction) * vehicle.speed * deltaTime;
  }
}

int MpiSimulation::ownerForCell(const std::int64_t cellX) const {
  const long double offset =
      static_cast<long double>(cellX) -
      static_cast<long double>(minimumCellX_);
  const long double span =
      static_cast<long double>(maximumCellX_) -
      static_cast<long double>(minimumCellX_) + 1.0L;
  const long double owner =
      offset * static_cast<long double>(processCount_) / span;
  return std::clamp(
      static_cast<int>(owner), 0, processCount_ - 1);
}

void MpiSimulation::redistributeBySpatialCell() {
  std::int64_t localMinimum =
      std::numeric_limits<std::int64_t>::max();
  std::int64_t localMaximum =
      std::numeric_limits<std::int64_t>::min();
  for (const auto& vehicle : localVehicles_) {
    if (!vehicle.active) {
      continue;
    }
    const auto cellX = cellXFor(vehicle, collisionCellSize_);
    localMinimum = std::min(localMinimum, cellX);
    localMaximum = std::max(localMaximum, cellX);
  }

  const auto communicationStart = MPI_Wtime();
  checkMpi(
      MPI_Allreduce(
          &localMinimum, &minimumCellX_, 1, MPI_INT64_T, MPI_MIN,
          communicator_),
      "MPI_Allreduce minimum cell");
  checkMpi(
      MPI_Allreduce(
          &localMaximum, &maximumCellX_, 1, MPI_INT64_T, MPI_MAX,
          communicator_),
      "MPI_Allreduce maximum cell");
  localCommunicationSeconds_ += MPI_Wtime() - communicationStart;

  std::vector<std::vector<VehicleWire>> outgoing(
      static_cast<std::size_t>(processCount_));
  std::vector<Vehicle> retained;
  retained.reserve(localVehicles_.size());
  for (const auto& vehicle : localVehicles_) {
    const int destination = vehicle.active
        ? ownerForCell(cellXFor(vehicle, collisionCellSize_))
        : rank_;
    if (destination == rank_) {
      retained.push_back(vehicle);
    } else {
      outgoing[static_cast<std::size_t>(destination)].push_back(
          toWire(vehicle));
    }
  }

  const auto migrationStart = MPI_Wtime();
  const auto migrated = exchangeByRank(
      outgoing, vehicleType_, communicator_, processCount_);
  localCommunicationSeconds_ += MPI_Wtime() - migrationStart;

  retained.reserve(retained.size() + migrated.size());
  for (const auto& wire : migrated) {
    retained.push_back(fromWire(wire));
  }
  std::sort(
      retained.begin(),
      retained.end(),
      [](const Vehicle& first, const Vehicle& second) {
        return first.id < second.id;
      });
  localVehicles_ = std::move(retained);
}

void MpiSimulation::exchangeCollisionHalos() {
  std::vector<std::vector<VehicleWire>> outgoing(
      static_cast<std::size_t>(processCount_));
  for (const auto& vehicle : localVehicles_) {
    if (!vehicle.active) {
      continue;
    }

    const auto cellX = cellXFor(vehicle, collisionCellSize_);
    int lastDestination = -1;
    for (const std::int64_t offset : {-1, 1}) {
      const auto neighborX = cellX + offset;
      if (neighborX < minimumCellX_ ||
          neighborX > maximumCellX_) {
        continue;
      }

      const int destination = ownerForCell(neighborX);
      if (destination != rank_ && destination != lastDestination) {
        outgoing[static_cast<std::size_t>(destination)].push_back(
            toWire(vehicle));
        lastDestination = destination;
      }
    }
  }

  const auto communicationStart = MPI_Wtime();
  const auto received = exchangeByRank(
      outgoing, vehicleType_, communicator_, processCount_);
  localCommunicationSeconds_ += MPI_Wtime() - communicationStart;

  haloVehicles_.clear();
  haloVehicles_.reserve(received.size());
  for (const auto& wire : received) {
    haloVehicles_.push_back(fromWire(wire));
  }
  std::sort(
      haloVehicles_.begin(),
      haloVehicles_.end(),
      [](const Vehicle& first, const Vehicle& second) {
        return first.id < second.id;
      });
  haloVehicles_.erase(
      std::unique(
          haloVehicles_.begin(),
          haloVehicles_.end(),
          [](const Vehicle& first, const Vehicle& second) {
            return first.id == second.id;
          }),
      haloVehicles_.end());
}

void MpiSimulation::step(const double deltaTime) {
  if (!std::isfinite(deltaTime) || deltaTime < 0.0) {
    throw std::invalid_argument(
        "deltaTime must be finite and non-negative");
  }

  const double movementStart = MPI_Wtime();
  updateLocalVehicles(deltaTime);
  localVehicleUpdateSeconds_ += MPI_Wtime() - movementStart;

  if (vehicleCount_ > 0) {
    redistributeBySpatialCell();
    exchangeCollisionHalos();

    std::vector<Vehicle> candidates = localVehicles_;
    candidates.insert(
        candidates.end(), haloVehicles_.begin(), haloVehicles_.end());

    const double collisionStart = MPI_Wtime();
    lastCollisionPairs_ =
        collisionSystem_.detectOwnedPairs(localVehicles_, candidates);
    localCollisionDetectionSeconds_ +=
        MPI_Wtime() - collisionStart;
    localCollisionCount_ += lastCollisionPairs_.size();
  } else {
    haloVehicles_.clear();
    lastCollisionPairs_.clear();
  }

  for (const auto& vehicle : localVehicles_) {
    validateVehicle(vehicle);
  }
  ++state_.stepsSimulated;
}

void MpiSimulation::run(const std::size_t steps,
                        const double deltaTime) {
  std::uint64_t rootSteps =
      rank_ == 0 ? static_cast<std::uint64_t>(steps) : 0;
  double rootDeltaTime = rank_ == 0 ? deltaTime : 0.0;
  double communicationStart = MPI_Wtime();
  checkMpi(
      MPI_Bcast(&rootSteps, 1, MPI_UINT64_T, 0, communicator_),
      "MPI_Bcast step count");
  checkMpi(
      MPI_Bcast(&rootDeltaTime, 1, MPI_DOUBLE, 0, communicator_),
      "MPI_Bcast delta time");
  const int localConfigurationValid =
      std::isfinite(deltaTime) && deltaTime >= 0.0 &&
              static_cast<std::uint64_t>(steps) == rootSteps &&
              deltaTime == rootDeltaTime
          ? 1
          : 0;
  int allConfigurationsValid = 0;
  checkMpi(
      MPI_Allreduce(
          &localConfigurationValid,
          &allConfigurationsValid,
          1,
          MPI_INT,
          MPI_MIN,
          communicator_),
      "MPI_Allreduce run configuration validation");
  localCommunicationSeconds_ += MPI_Wtime() - communicationStart;
  if (allConfigurationsValid == 0) {
    throw std::invalid_argument(
        "MPI processes must use matching steps and a finite, non-negative deltaTime");
  }

  communicationStart = MPI_Wtime();
  checkMpi(MPI_Barrier(communicator_), "MPI_Barrier before run");
  localCommunicationSeconds_ += MPI_Wtime() - communicationStart;
  const double totalStart = MPI_Wtime();
  for (std::size_t stepIndex = 0; stepIndex < steps; ++stepIndex) {
    step(deltaTime);
  }
  const double localTotalSeconds = MPI_Wtime() - totalStart;

  double localMetrics[3] = {
      localVehicleUpdateSeconds_,
      localCollisionDetectionSeconds_,
      localCommunicationSeconds_};
  double maximumMetrics[3]{};
  communicationStart = MPI_Wtime();
  checkMpi(
      MPI_Allreduce(
          localMetrics, maximumMetrics, 3, MPI_DOUBLE, MPI_MAX,
          communicator_),
      "MPI_Allreduce timing metrics");
  state_.vehicleUpdateSeconds = maximumMetrics[0];
  state_.collisionDetectionSeconds = maximumMetrics[1];

  const double localTotal = localTotalSeconds;
  checkMpi(
      MPI_Allreduce(
          &localTotal, &state_.totalSeconds, 1, MPI_DOUBLE, MPI_MAX,
          communicator_),
      "MPI_Allreduce total time");
  localCommunicationSeconds_ += MPI_Wtime() - communicationStart;

  const auto localCollisions = localCollisionCount_;
  std::uint64_t globalCollisions = 0;
  communicationStart = MPI_Wtime();
  checkMpi(
      MPI_Allreduce(
          &localCollisions, &globalCollisions, 1, MPI_UINT64_T, MPI_SUM,
          communicator_),
      "MPI_Allreduce collision count");
  localCommunicationSeconds_ += MPI_Wtime() - communicationStart;
  communicationStart = MPI_Wtime();
  double maximumCommunicationSeconds = 0.0;
  checkMpi(
      MPI_Allreduce(
          &localCommunicationSeconds_,
          &maximumCommunicationSeconds,
          1,
          MPI_DOUBLE,
          MPI_MAX,
          communicator_),
      "MPI_Allreduce communication time");
  state_.communicationSeconds = maximumCommunicationSeconds;
  state_.collisionCount =
      static_cast<std::size_t>(globalCollisions);
  localCommunicationSeconds_ += MPI_Wtime() - communicationStart;
}

int MpiSimulation::rank() const noexcept {
  return rank_;
}

int MpiSimulation::processCount() const noexcept {
  return processCount_;
}

const std::vector<Vehicle>& MpiSimulation::localVehicles() const noexcept {
  return localVehicles_;
}

const RaceState& MpiSimulation::state() const noexcept {
  return state_;
}

double MpiSimulation::globalChecksum() const {
  double localChecksum = 0.0;
  for (const auto& vehicle : localVehicles_) {
    localChecksum += (static_cast<double>(vehicle.id) + 1.0) *
                     (vehicle.x + vehicle.z);
  }
  double global = 0.0;
  checkMpi(
      MPI_Allreduce(
          &localChecksum, &global, 1, MPI_DOUBLE, MPI_SUM,
          communicator_),
      "MPI_Allreduce checksum");
  return global;
}

std::vector<Vehicle> MpiSimulation::gatherVehicles(const int root) const {
  const auto localWire = toWire(localVehicles_);
  const auto gathered = gatherRecords(
      localWire, vehicleType_, communicator_,
      rank_, processCount_, root);

  std::vector<Vehicle> vehicles;
  if (rank_ == root) {
    vehicles.reserve(gathered.size());
    for (const auto& wire : gathered) {
      vehicles.push_back(fromWire(wire));
    }
    std::sort(
        vehicles.begin(),
        vehicles.end(),
        [](const Vehicle& first, const Vehicle& second) {
          return first.id < second.id;
        });
  }
  return vehicles;
}

std::vector<GlobalCollisionPair>
MpiSimulation::gatherLastCollisionPairs(const int root) const {
  std::vector<PairWire> local;
  local.reserve(lastCollisionPairs_.size());
  for (const auto& pair : lastCollisionPairs_) {
    local.push_back({pair.firstId, pair.secondId});
  }

  MPI_Datatype pairType = createPairType();
  const auto gathered = gatherRecords(
      local, pairType, communicator_, rank_, processCount_, root);
  MPI_Type_free(&pairType);

  std::vector<GlobalCollisionPair> pairs;
  if (rank_ == root) {
    pairs.reserve(gathered.size());
    for (const auto& pair : gathered) {
      pairs.push_back({pair.firstId, pair.secondId});
    }
    std::sort(
        pairs.begin(),
        pairs.end(),
        [](const GlobalCollisionPair& first,
           const GlobalCollisionPair& second) {
          return first.firstId < second.firstId ||
                 (first.firstId == second.firstId &&
                  first.secondId < second.secondId);
        });
    pairs.erase(std::unique(pairs.begin(), pairs.end()), pairs.end());
  }
  return pairs;
}

}  // namespace neon_rush
